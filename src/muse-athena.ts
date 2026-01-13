/**
 * Muse Athena Client
 * Support for new Athena-based Muse headsets with tag-based packet protocol
 */

import { BehaviorSubject, firstValueFrom, fromEvent, merge, Observable, Subject } from 'rxjs';
import { filter, first, map, share, take, mergeMap } from 'rxjs';

import type {
    EEGReading,
    AthenaAccGyroSample,
    AthenaOpticalReading,
    AthenaBatteryData,
    EventMarker,
    MuseControlResponse,
    MuseDeviceInfo,
    RawAthenaPacket,
} from './lib/muse-interfaces';
import { parseControl } from './lib/muse-parse';
import { decodeResponse, observableCharacteristic } from './lib/muse-utils';
import { parsePacket } from './lib/athena-parser';

export const MUSE_SERVICE = 0xfe8d;

// Athena BLE UUIDs
const ATHENA_CONTROL_CHAR_UUID = '273e0001-4c4d-454d-96be-f03bac821358';
const ATHENA_SENSOR_CHAR_UUIDS = [
    '273e0013-4c4d-454d-96be-f03bac821358', // UNIVERSAL / combined sensors
    '273e0003-4c4d-454d-96be-f03bac821358', // EEG TP9 (fallback)
];

export const opticalChannelNames = ['ambient', 'infrared', 'red'];
export const channelNames = ['TP9', 'AF7', 'AF8', 'TP10', 'FPz', 'AUX_R', 'AUX_L', 'AUX'];

export const ATHENA_COMMANDS = {
    v4: new Uint8Array([0x03, 0x76, 0x34, 0x0a]),
    v6: new Uint8Array([0x03, 0x76, 0x36, 0x0a]),
    s: new Uint8Array([0x02, 0x73, 0x0a]),
    h: new Uint8Array([0x02, 0x68, 0x0a]),
    p21: new Uint8Array([0x04, 0x70, 0x32, 0x31, 0x0a]),
    p1034: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x34, 0x0a]),
    p1035: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x35, 0x0a]),
    p1045: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x35, 0x0a]),
    d: new Uint8Array([0x02, 0x64, 0x0a]),
    dc001: new Uint8Array([0x06, 0x64, 0x63, 0x30, 0x30, 0x31, 0x0a]),
    L1: new Uint8Array([0x03, 0x4c, 0x31, 0x0a]),
};

export type AthenaPreset = 'p21' | 'p1034' | 'p1035' | 'p1045';
export const ATHENA_PRESETS: AthenaPreset[] = ['p21', 'p1034', 'p1035', 'p1045'];

export class MuseAthenaClient {
    deviceName: string | null = '';
    connectionStatus = new BehaviorSubject<boolean>(false);

    rawControlData!: Observable<string>;
    controlResponses!: Observable<MuseControlResponse>;
    eegReadings!: Observable<EEGReading>;
    accGyroReadings!: Observable<AthenaAccGyroSample>;
    opticalReadings!: Observable<AthenaOpticalReading>;
    batteryData!: Observable<AthenaBatteryData>;
    rawPackets!: Observable<RawAthenaPacket>;

    private commandLock: Promise<void> = Promise.resolve();
    eventMarkers: Subject<EventMarker> = new Subject();

    private gatt: BluetoothRemoteGATTServer | null = null;
    private controlChar!: BluetoothRemoteGATTCharacteristic;
    private athenaSensorChar!: BluetoothRemoteGATTCharacteristic;

    // Timestamp tracking state
    private lastEegIndex: number | null = null;
    private lastEegTimestamp: number | null = null;
    private lastAccGyroIndex: number | null = null;
    private lastAccGyroTimestamp: number | null = null;
    private lastOpticalIndex: number | null = null;
    private lastOpticalTimestamp: number | null = null;

    async connect(gatt?: BluetoothRemoteGATTServer) {
        if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
            throw new Error('Web Bluetooth requires a secure context (https or localhost).');
        }

        if (gatt) {
            this.gatt = gatt;
        } else {
            let device: BluetoothDevice | null = null;
            const bt = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
            if (bt && typeof (bt as any).getDevices === 'function') {
                try {
                    const devices: BluetoothDevice[] = await (bt as any).getDevices();
                    device = devices.find((d) => d.name?.startsWith('Muse')) || null;
                } catch {
                    // Ignore and fallback to requestDevice
                }
            }
            if (!device) {
                device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [MUSE_SERVICE], namePrefix: 'Muse' }],
                    optionalServices: [MUSE_SERVICE],
                });
            }
            this.gatt = await device.gatt!.connect();
        }

        this.deviceName = this.gatt.device.name || null;
        const service = await this.gatt.getPrimaryService(MUSE_SERVICE);
        fromEvent(this.gatt.device, 'gattserverdisconnected')
            .pipe(first())
            .subscribe(() => {
                this.gatt = null;
                this.connectionStatus.next(false);
            });

        this.controlChar = await service.getCharacteristic(ATHENA_CONTROL_CHAR_UUID);
        const controlObservable = (await observableCharacteristic(this.controlChar)).pipe(
            map((data) => ({ uuid: this.controlChar.uuid, data: new Uint8Array(data.buffer) })),
            share(),
        );

        this.rawControlData = controlObservable.pipe(
            map((p) => {
                try {
                    if (p.data[0] > p.data.length) return new TextDecoder().decode(p.data);
                    return decodeResponse(p.data);
                } catch {
                    return '';
                }
            }),
            share(),
        );
        this.controlResponses = parseControl(this.rawControlData);

        let sensorChar: BluetoothRemoteGATTCharacteristic | null = null;
        for (const charUuid of ATHENA_SENSOR_CHAR_UUIDS) {
            try {
                sensorChar = await service.getCharacteristic(charUuid);
                break;
            } catch {
                // Try next UUID
            }
        }
        if (!sensorChar) throw new Error('Could not find Athena sensor characteristic');
        this.athenaSensorChar = sensorChar;

        const sensorObservable = (await observableCharacteristic(this.athenaSensorChar)).pipe(
            map((data) => ({ uuid: this.athenaSensorChar.uuid, data: new Uint8Array(data.buffer) })),
            share(),
        );

        this.rawPackets = merge(controlObservable, sensorObservable).pipe(
            map((p) => ({ ...p, timestamp: Date.now() })),
            share(),
        );

        const rawSensorPackets$ = sensorObservable.pipe(
            map((p) => p.data),
            share(),
        );

        this.eegReadings = rawSensorPackets$.pipe(
            mergeMap((packet) => this.parseAthenaPacketForTag<EEGReading>(packet, 0x12)),
            share(),
        );

        this.accGyroReadings = rawSensorPackets$.pipe(
            mergeMap((packet) => this.parseAthenaPacketForTag<AthenaAccGyroSample>(packet, 0x47)),
            share(),
        );

        this.opticalReadings = rawSensorPackets$.pipe(
            mergeMap((packet) => this.parseAthenaPacketForTag<AthenaOpticalReading>(packet, 0x34)),
            share(),
        );

        this.batteryData = rawSensorPackets$.pipe(
            map((packet) => this.parseAthenaBatterySync(packet)),
            filter((data) => data !== null),
            map((data) => data as AthenaBatteryData),
            share(),
        );

        this.connectionStatus.next(true);
    }

    private parseAthenaPacketForTag<T>(packet: Uint8Array, targetTag: number): Observable<T> {
        return new Observable<T>((observer) => {
            if (packet.length < 10) {
                observer.complete();
                return;
            }
            const eventIndex = packet[1];
            let idx = 9;

            while (idx < packet.length) {
                const tag = packet[idx];
                try {
                    const [nextIdx, , entries] = parsePacket(packet, tag, idx, false);
                    if (tag === targetTag) {
                        if (tag === 0x12) {
                            // !!! CRITICAL: Get timestamp ONCE per tag to keep channels synchronized
                            const timestamp = this.getAthenaTimestamp(eventIndex, 2, 256, 'eeg');
                            for (const entry of entries) {
                                const allSamples = entry.data;
                                for (let ch = 0; ch < 8 && ch * 2 < allSamples.length; ch++) {
                                    const samplesArr = allSamples.slice(ch * 2, ch * 2 + 2);
                                    if (samplesArr.length === 2) {
                                        observer.next({
                                            index: eventIndex,
                                            electrode: ch,
                                            timestamp: timestamp, // Shared across channels
                                            samples: samplesArr,
                                        } as unknown as T);
                                    }
                                }
                            }
                        } else if (tag === 0x47) {
                            for (let i = 0; i < 3; i++) {
                                const timestamp = this.getAthenaTimestamp(eventIndex, 1, 52, 'accgyro');
                                const accEntry = entries[i * 2];
                                const gyroEntry = entries[i * 2 + 1];
                                if (accEntry && accEntry.type === 'ACC') {
                                    observer.next({
                                        index: eventIndex,
                                        timestamp,
                                        acc: { x: accEntry.data[0], y: accEntry.data[1], z: accEntry.data[2] },
                                        gyro: {
                                            x: gyroEntry?.data[0] || 0,
                                            y: gyroEntry?.data[1] || 0,
                                            z: gyroEntry?.data[2] || 0,
                                        },
                                    } as unknown as T);
                                }
                            }
                        } else if (tag === 0x34) {
                            for (let i = 0; i < 3; i++) {
                                const timestamp = this.getAthenaTimestamp(eventIndex, 1, 64, 'optical');
                                const optEntry = entries[i];
                                if (optEntry && optEntry.type === 'OPTICAL') {
                                    observer.next({
                                        index: eventIndex,
                                        opticalChannel: i % 3,
                                        timestamp,
                                        samples: optEntry.data,
                                    } as unknown as T);
                                }
                            }
                        }
                    } else if (tag === 0x12 || tag === 0x47 || tag === 0x34) {
                        // Mark time for other streaming tags even if they aren't our target
                        this.getAthenaTimestamp(
                            eventIndex,
                            1,
                            256,
                            tag === 0x12 ? 'eeg' : tag === 0x47 ? 'accgyro' : 'optical',
                        );
                    }

                    if (nextIdx <= idx) {
                        idx += 1;
                    } else {
                        idx = nextIdx;
                    }
                } catch {
                    idx += 1;
                }
            }
            observer.complete();
        });
    }

    private parseAthenaBatterySync(packet: Uint8Array): AthenaBatteryData | null {
        if (packet.length < 10) return null;
        let idx = 9;
        while (idx < packet.length) {
            const tag = packet[idx];
            try {
                const [nextIdx, , entries] = parsePacket(packet, tag, idx, false);
                if (tag === 0x88) {
                    return { timestamp: Date.now(), values: entries[0].data };
                }
                if (nextIdx <= idx) {
                    idx += 1;
                } else {
                    idx = nextIdx;
                }
            } catch {
                idx += 1;
            }
        }
        return null;
    }

    async sendCommand(cmd: string) {
        const cmdBytes = ATHENA_COMMANDS[cmd as keyof typeof ATHENA_COMMANDS];
        if (!cmdBytes) throw new Error(`Unknown Athena command: ${cmd}`);
        this.commandLock = this.commandLock.then(async () => {
            console.log(`[Athena] Sending command: ${cmd}`);
            await this.controlChar.writeValueWithoutResponse(cmdBytes);
            await this.delay(50);
        });
        return this.commandLock;
    }

    async start(preset: string = 'p1045') {
        console.log('[Athena] Starting sequence');
        await this.sendCommand('v4');
        await this.delay(100);
        await this.sendCommand('s');
        await this.delay(100);
        await this.sendCommand('h');
        await this.delay(100);
        await this.sendCommand(preset);
        await this.delay(100);
        await this.sendCommand('dc001');
        await this.delay(50);
        await this.sendCommand('dc001');
        await this.delay(100);
        await this.sendCommand('L1');
        await this.delay(100);
        await this.delay(2000);
        console.log('[Athena] Stream complete!');
    }

    async stop() {
        try {
            await this.sendCommand('h');
        } catch {
            // Already stopped or disconnected
        }
    }
    async pause() {
        await this.sendCommand('h');
    }
    async resume() {
        await this.sendCommand('dc001');
    }

    async deviceInfo(): Promise<MuseDeviceInfo> {
        const resultListener = this.controlResponses.pipe(
            filter((r) => !!r.fw),
            take(1),
        );
        await this.sendCommand('v6');
        return firstValueFrom(resultListener) as Promise<MuseDeviceInfo>;
    }

    async injectMarker(value: string | number, timestamp: number = new Date().getTime()) {
        await this.eventMarkers.next({ value, timestamp });
    }

    disconnect() {
        if (this.gatt) {
            this.lastEegIndex = null;
            this.lastEegTimestamp = null;
            this.lastAccGyroIndex = null;
            this.lastAccGyroTimestamp = null;
            this.lastOpticalIndex = null;
            this.lastOpticalTimestamp = null;
            if (this.gatt.connected) this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private getAthenaTimestamp(
        eventIndex: number,
        samplesPerReading: number,
        frequency: number,
        dataType: string,
    ): number {
        const READING_DELTA = 1000 * (1.0 / frequency) * samplesPerReading;
        let lastIndex =
            dataType === 'eeg'
                ? this.lastEegIndex
                : dataType === 'accgyro'
                  ? this.lastAccGyroIndex
                  : this.lastOpticalIndex;
        let lastTimestamp =
            dataType === 'eeg'
                ? this.lastEegTimestamp
                : dataType === 'accgyro'
                  ? this.lastAccGyroTimestamp
                  : this.lastOpticalTimestamp;

        const now = Date.now();
        if (lastIndex === null || lastTimestamp === null || now - lastTimestamp > 500) {
            // Recalibrate or initial
            lastTimestamp = now - READING_DELTA;
        } else {
            // !!! FIX: Just increment by nominal delta to maintain exact 256Hz speed
            // Global eventIndex gaps in Athena represent other packets (IMU/etc), not time.
            lastTimestamp = lastTimestamp + READING_DELTA;
        }

        if (dataType === 'eeg') {
            this.lastEegIndex = eventIndex;
            this.lastEegTimestamp = lastTimestamp;
        } else if (dataType === 'accgyro') {
            this.lastAccGyroIndex = eventIndex;
            this.lastAccGyroTimestamp = lastTimestamp;
        } else {
            this.lastOpticalIndex = eventIndex;
            this.lastOpticalTimestamp = lastTimestamp;
        }

        return lastTimestamp;
    }
}
