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
import { parseAthenaNotification } from './lib/athena-parser';

export { channelNames, opticalChannelNames, selectOpticsChannels } from './lib/athena-parser';

export const MUSE_SERVICE = 0xfe8d;

// Athena BLE UUIDs
const ATHENA_CONTROL_CHAR_UUID = '273e0001-4c4d-454d-96be-f03bac821358';
const ATHENA_SENSOR_CHAR_UUIDS = [
    '273e0013-4c4d-454d-96be-f03bac821358', // UNIVERSAL / combined sensors
    '273e0003-4c4d-454d-96be-f03bac821358', // EEG TP9 (fallback)
];

export const ATHENA_COMMANDS = {
    v4: new Uint8Array([0x03, 0x76, 0x34, 0x0a]),
    v6: new Uint8Array([0x03, 0x76, 0x36, 0x0a]),
    s: new Uint8Array([0x02, 0x73, 0x0a]),
    h: new Uint8Array([0x02, 0x68, 0x0a]),
    p21: new Uint8Array([0x04, 0x70, 0x32, 0x31, 0x0a]),
    p1034: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x34, 0x0a]),
    p1035: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x35, 0x0a]),
    p1041: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x31, 0x0a]),
    p1042: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x32, 0x0a]),
    p1044: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x34, 0x0a]),
    p1045: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x35, 0x0a]),
    p1046: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x36, 0x0a]),
    p4129: new Uint8Array([0x06, 0x70, 0x34, 0x31, 0x32, 0x39, 0x0a]),
    d: new Uint8Array([0x02, 0x64, 0x0a]),
    dc001: new Uint8Array([0x06, 0x64, 0x63, 0x30, 0x30, 0x31, 0x0a]),
    L1: new Uint8Array([0x03, 0x4c, 0x31, 0x0a]),
};

export type AthenaPreset = 'p21' | 'p1034' | 'p1035' | 'p1041' | 'p1042' | 'p1044' | 'p1045' | 'p1046' | 'p4129';
export const ATHENA_PRESETS: AthenaPreset[] = [
    'p21',
    'p1034',
    'p1035',
    'p1041',
    'p1042',
    'p1044',
    'p1045',
    'p1046',
    'p4129',
];

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

    // Timestamp tracking state - last real arrival time per sensor type (matches
    // BrainFlow's get_sample_timestamp / reset_timestamps).
    private lastEegTimestamp: number | null = null;
    private lastAccGyroTimestamp: number | null = null;
    private lastOpticalTimestamp: number | null = null;

    // Per-sensor-type sequential index. `AthenaParsedBlock.packageNum` is a physical
    // BLE-packet-level sequence number shared across every sensor type in a notification,
    // so a sensor type only receiving every Nth physical packet would see its `index`
    // jump by N instead of counting 0,1,2,... -- these counters give each sensor stream
    // its own independent, densely-increasing index instead.
    private eegIndexCounter = 0;
    private accGyroIndexCounter = 0;
    private opticalIndexCounter = 0;

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
            mergeMap((packet) => this.parseAthenaPacketForType<EEGReading>(packet, 'EEG')),
            share(),
        );

        this.accGyroReadings = rawSensorPackets$.pipe(
            mergeMap((packet) => this.parseAthenaPacketForType<AthenaAccGyroSample>(packet, 'ACC_GYRO')),
            share(),
        );

        this.opticalReadings = rawSensorPackets$.pipe(
            mergeMap((packet) => this.parseAthenaPacketForType<AthenaOpticalReading>(packet, 'OPTICAL')),
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

    private resetTimestampState(): void {
        this.lastEegTimestamp = null;
        this.lastAccGyroTimestamp = null;
        this.lastOpticalTimestamp = null;
        this.eegIndexCounter = 0;
        this.accGyroIndexCounter = 0;
        this.opticalIndexCounter = 0;
    }

    private getPacketBaseTimestamp(
        lastTimestamp: number | null,
        currentTimestamp: number,
        nSamples: number,
        rateHz: number,
    ): number {
        // A gap this large implies a real stall/disconnect rather than routine BLE
        // jitter -- resync to real time instead of dragging a stale virtual clock forward.
        if (lastTimestamp !== null && currentTimestamp - lastTimestamp > 1000) {
            lastTimestamp = null;
        }
        if (lastTimestamp === null) {
            return currentTimestamp - ((nSamples - 1) * 1000) / rateHz;
        }
        if (currentTimestamp <= lastTimestamp) {
            return currentTimestamp;
        }
        const predicted = lastTimestamp + (nSamples * 1000) / rateHz;
        if (predicted <= currentTimestamp) {
            return predicted;
        }
        const step = (currentTimestamp - lastTimestamp) / nSamples;
        return lastTimestamp + step;
    }

    private parseAthenaPacketForType<T>(packet: Uint8Array, targetType: string): Observable<T> {
        return new Observable<T>((observer) => {
            const physicalPackets = parseAthenaNotification(packet);

            for (const physicalPacket of physicalPackets) {
                const matchingBlocks = physicalPacket.blocks.filter((block) => block.type === targetType);
                if (matchingBlocks.length === 0) continue;

                const hostTimestamp = Date.now();

                for (const block of matchingBlocks) {
                    const { entries, samples, freqHz } = block;

                    if (targetType === 'EEG') {
                        const eventIndex = this.eegIndexCounter++;
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastEegTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastEegTimestamp = packetTimestamp;

                        for (const entry of entries) {
                            const allSamples = entry.data;
                            const channels = allSamples.length / samples;
                            for (let ch = 0; ch < channels; ch++) {
                                const samplesArr = Array.from({ length: samples }, (_, sampleIndex) => {
                                    return allSamples[sampleIndex * channels + ch];
                                });
                                observer.next({
                                    index: eventIndex,
                                    electrode: ch,
                                    timestamp: packetTimestamp,
                                    samples: samplesArr,
                                } as unknown as T);
                            }
                        }
                    } else if (targetType === 'ACC_GYRO') {
                        const eventIndex = this.accGyroIndexCounter++;
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastAccGyroTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastAccGyroTimestamp = packetTimestamp;

                        for (let i = 0; i < samples; i++) {
                            const accEntry = entries[i * 2];
                            const gyroEntry = entries[i * 2 + 1];
                            if (accEntry && accEntry.type === 'ACC') {
                                observer.next({
                                    index: eventIndex,
                                    timestamp: packetTimestamp,
                                    acc: { x: accEntry.data[0], y: accEntry.data[1], z: accEntry.data[2] },
                                    gyro: {
                                        x: gyroEntry?.data[0] || 0,
                                        y: gyroEntry?.data[1] || 0,
                                        z: gyroEntry?.data[2] || 0,
                                    },
                                } as unknown as T);
                            }
                        }
                    } else if (targetType === 'OPTICAL') {
                        const eventIndex = this.opticalIndexCounter++;
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastOpticalTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastOpticalTimestamp = packetTimestamp;

                        for (let i = 0; i < samples; i++) {
                            const optEntry = entries[i];
                            if (optEntry && optEntry.type === 'OPTICAL') {
                                observer.next({
                                    index: eventIndex,
                                    timestamp: packetTimestamp,
                                    samples: optEntry.data,
                                } as unknown as T);
                            }
                        }
                    }
                }
            }

            observer.complete();
        });
    }

    private parseAthenaBatterySync(packet: Uint8Array): AthenaBatteryData | null {
        const physicalPackets = parseAthenaNotification(packet);
        for (const physicalPacket of physicalPackets) {
            const batteryBlock = physicalPacket.blocks.find((block) => block.type === 'BATTERY');
            if (batteryBlock) {
                return { timestamp: Date.now(), values: batteryBlock.entries[0].data };
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

    async start(preset: AthenaPreset = 'p1045') {
        this.resetTimestampState();
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
        this.resetTimestampState();
        try {
            await this.sendCommand('h');
        } catch {
            // Already stopped or disconnected
        }
    }
    async pause() {
        this.resetTimestampState();
        await this.sendCommand('h');
    }
    async resume() {
        this.resetTimestampState();
        await this.sendCommand('dc001');
    }

    async deviceInfo(): Promise<MuseDeviceInfo> {
        const jsonResponse$ = this.controlResponses.pipe(
            filter((r): r is MuseDeviceInfo => typeof r.fw === 'string'),
            take(1),
        );

        const textResponse$ = this.rawControlData.pipe(
            map((value) => this.parseAthenaDeviceInfoText(value)),
            filter((value): value is MuseDeviceInfo => value !== null),
            take(1),
        );

        await this.sendCommand('v6');
        return firstValueFrom(merge(jsonResponse$, textResponse$).pipe(take(1))) as Promise<MuseDeviceInfo>;
    }

    async injectMarker(value: string | number, timestamp: number = new Date().getTime()) {
        await this.eventMarkers.next({ value, timestamp });
    }

    disconnect() {
        if (this.gatt) {
            this.resetTimestampState();
            if (this.gatt.connected) this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private parseAthenaDeviceInfoText(raw: string): MuseDeviceInfo | null {
        const normalized = raw.replace(/^:+/, '').trim();
        if (!normalized) return null;

        // Athena devices often answer v6 with plain text (example: "Athena_R...") instead of JSON.
        if (!/athena|muse|version|_r/i.test(normalized)) {
            return null;
        }

        return {
            rc: 0,
            ap: 'athena',
            sp: '',
            tp: 'consumer',
            hw: '',
            bn: 0,
            fw: normalized,
            bl: '',
            pv: 0,
        };
    }
}
