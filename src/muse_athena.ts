/**
 * Muse Athena Client
 * Support for new Athena-based Muse headsets with tag-based packet protocol
 */

import { BehaviorSubject, firstValueFrom, fromEvent, Observable, Subject } from 'rxjs';
import { filter, first, map, share, take } from 'rxjs';

import type {
    AthenaEEGReading,
    AthenaAccGyroReading,
    AthenaOpticalReading,
    AthenaBatteryData,
    EventMarker,
    XYZ,
    MuseControlResponse,
    MuseDeviceInfo,
} from './lib/muse-interfaces';
import { parseControl } from './lib/muse-parse';
import { decodeResponse, observableCharacteristic } from './lib/muse-utils';
import { parsePacket, type AthenaEntry } from './lib/athena-parser';

export const MUSE_SERVICE = 0xfe8d;

// Athena BLE UUIDs
const ATHENA_CONTROL_CHAR_UUID = '273e0001-4c4d-454d-96be-f03bac821358';
const ATHENA_SENSOR_CHAR_UUIDS = [
    '273e0013-4c4d-454d-96be-f03bac821358', // UNIVERSAL / combined sensors
    '273e0003-4c4d-454d-96be-f03bac821358', // EEG TP9 (fallback)
];

// Athena commands (tag-based protocol)
const ATHENA_COMMANDS = {
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

/**
 * MuseAthennaClient - Bluetooth client for Athena-based Muse headsets
 *
 * Athena uses a tag-based packet protocol:
 * - 0x12: EEG data (8 channels, 2 samples, 256 Hz)
 * - 0x47: ACC/GYRO data (3 samples, 52 Hz)
 * - 0x34: Optical data (3 samples, 64 Hz)
 * - 0x98: Battery data (10 values, 0.1 Hz)
 */
export class MuseAthenaClient {
    deviceName: string | null = '';
    connectionStatus = new BehaviorSubject<boolean>(false);

    // Athena streaming observables
    rawControlData!: Observable<string>;
    controlResponses!: Observable<MuseControlResponse>;
    athenaEegReadings!: Observable<AthenaEEGReading>;
    athenaAccGyroReadings!: Observable<AthenaAccGyroReading>;
    athenaOpticalReadings!: Observable<AthenaOpticalReading>;
    athenaBatteryData!: Observable<AthenaBatteryData>;

    eventMarkers: Subject<EventMarker> = new Subject();

    private gatt: BluetoothRemoteGATTServer | null = null;
    private controlChar!: BluetoothRemoteGATTCharacteristic;
    private athenaSensorChar!: BluetoothRemoteGATTCharacteristic;

    // Locate a specific tag inside a packet, even if the notification contains a leading header.
    private findTaggedPacket(packet: Uint8Array, tag: number): [number, AthenaEntry[]] | null {
        for (let i = 0; i < packet.length; i++) {
            if (packet[i] !== tag) continue;
            try {
                const [, typeName, entries] = parsePacket(packet, tag, i, false);
                if (typeName.startsWith('UNKNOWN')) continue;
                if (i > 0) {
                    console.log(
                        `[Athena] Found tag 0x${tag.toString(16)} at offset ${i} (skipped ${i} bytes of header?)`,
                    );
                }
                return [i, entries];
            } catch (err) {
                console.error(`[Athena] Failed to parse tag 0x${tag.toString(16)} at offset ${i}:`, err);
            }
        }
        return null;
    }

    async connect(gatt?: BluetoothRemoteGATTServer) {
        // Web Bluetooth must run in a secure context (https or localhost)
        // In test (Node) environment, isSecureContext is undefined – only enforce when available.
        if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
            throw new Error('Web Bluetooth requires a secure context (https or localhost).');
        }

        if (gatt) {
            this.gatt = gatt;
        } else {
            // Prefer previously authorized devices to avoid showing the chooser when possible
            let device: BluetoothDevice | null = null;
            const bt = (
                navigator as Navigator & { bluetooth?: Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> } }
            ).bluetooth;
            if (bt && typeof bt.getDevices === 'function') {
                try {
                    const devices: BluetoothDevice[] = await bt.getDevices();
                    device = devices.find((d) => d.name?.startsWith('Muse')) || null;
                } catch {
                    // Ignore and fallback to requestDevice
                }
            }

            if (!device) {
                device = await navigator.bluetooth.requestDevice({
                    filters: [
                        {
                            services: [MUSE_SERVICE],
                            namePrefix: 'Muse',
                        },
                    ],
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

        // Control characteristic (for commands and device info)
        this.controlChar = await service.getCharacteristic(ATHENA_CONTROL_CHAR_UUID);
        this.rawControlData = (await observableCharacteristic(this.controlChar)).pipe(
            map((data) => decodeResponse(new Uint8Array(data.buffer))),
            share(),
        );
        this.controlResponses = parseControl(this.rawControlData);

        // Sensor characteristic (for data - prefer UNIVERSAL first)
        let sensorChar: BluetoothRemoteGATTCharacteristic | null = null;
        for (const charUuid of ATHENA_SENSOR_CHAR_UUIDS) {
            try {
                sensorChar = await service.getCharacteristic(charUuid);
                console.log(`[Athena] Using sensor characteristic: ${charUuid}`);
                break;
            } catch {
                console.log(`[Athena] Sensor characteristic not found: ${charUuid}`);
            }
        }

        if (!sensorChar) {
            throw new Error('Could not find Athena sensor characteristic');
        }

        this.athenaSensorChar = sensorChar;

        // Create observables from sensor packets
        const sensorObservable = (await observableCharacteristic(this.athenaSensorChar)).pipe(
            map((data) => {
                const packet = new Uint8Array(data.buffer);
                console.log(
                    `[Athena] Raw packet received (${packet.length} bytes), tag: 0x${packet[0]?.toString(16).padStart(2, '0')}`,
                );
                return packet;
            }),
            share(),
        );

        // Athena EEG readings (tag 0x12)
        this.athenaEegReadings = sensorObservable.pipe(
            map((packet) => this.parseAthenaEegPacket(packet)),
            filter((reading) => reading !== null),
            map((reading) => reading as AthenaEEGReading),
        );

        // Athena ACC/GYRO readings (tag 0x47)
        this.athenaAccGyroReadings = sensorObservable.pipe(
            map((packet) => this.parseAthenaAccGyroPacket(packet)),
            filter((reading) => reading !== null),
            map((reading) => reading as AthenaAccGyroReading),
        );

        // Athena Optical readings (tag 0x34)
        this.athenaOpticalReadings = sensorObservable.pipe(
            map((packet) => this.parseAthenaOpticalPacket(packet)),
            filter((reading) => reading !== null),
            map((reading) => reading as AthenaOpticalReading),
        );

        // Athena Battery data (tag 0x98)
        this.athenaBatteryData = sensorObservable.pipe(
            map((packet) => this.parseAthenaBatteryPacket(packet)),
            filter((reading) => reading !== null),
            map((reading) => reading as AthenaBatteryData),
        );

        this.connectionStatus.next(true);
    }

    private parseAthenaEegPacket(packet: Uint8Array): AthenaEEGReading | null {
        if (packet.length < 1) return null;
        const found = this.findTaggedPacket(packet, 0x12);
        if (!found) return null;

        const [, entries] = found;
        console.log(`[Athena] EEG packet parsed, entries: ${entries.length}`);

        let samples: number[] = [];
        for (const entry of entries) {
            if (entry.type === 'EEG') {
                samples = samples.concat(entry.data);
            }
        }

        console.log(`[Athena] EEG samples: ${samples.length} values`);
        return {
            timestamp: new Date().getTime(),
            samples,
        };
    }

    private parseAthenaAccGyroPacket(packet: Uint8Array): AthenaAccGyroReading | null {
        if (packet.length < 1) return null;
        const found = this.findTaggedPacket(packet, 0x47);
        if (!found) return null;

        const [, entries] = found;

        const acc: XYZ[] = [];
        const gyro: XYZ[] = [];

        for (const entry of entries) {
            if (entry.type === 'ACC' && entry.data.length === 3) {
                acc.push({ x: entry.data[0], y: entry.data[1], z: entry.data[2] });
            } else if (entry.type === 'GYRO' && entry.data.length === 3) {
                gyro.push({ x: entry.data[0], y: entry.data[1], z: entry.data[2] });
            }
        }

        return {
            timestamp: new Date().getTime(),
            acc,
            gyro,
        };
    }

    private parseAthenaOpticalPacket(packet: Uint8Array): AthenaOpticalReading | null {
        if (packet.length < 1) return null;
        const found = this.findTaggedPacket(packet, 0x34);
        if (!found) return null;

        const [, entries] = found;

        let samples: number[] = [];
        for (const entry of entries) {
            if (entry.type === 'OPTICAL') {
                samples = samples.concat(entry.data);
            }
        }

        return {
            timestamp: new Date().getTime(),
            samples,
        };
    }

    private parseAthenaBatteryPacket(packet: Uint8Array): AthenaBatteryData | null {
        if (packet.length < 1) return null;
        const found = this.findTaggedPacket(packet, 0x98);
        if (!found) return null;

        const [, entries] = found;

        let values: number[] = [];
        for (const entry of entries) {
            if (entry.type === 'BATTERY') {
                values = values.concat(entry.data);
            }
        }

        return {
            timestamp: new Date().getTime(),
            values,
        };
    }

    async sendCommand(cmd: string) {
        const cmdBytes = ATHENA_COMMANDS[cmd as keyof typeof ATHENA_COMMANDS];
        if (!cmdBytes) {
            throw new Error(`Unknown Athena command: ${cmd}`);
        }
        console.log(`[Athena] Sending command: ${cmd}`);
        await this.controlChar.writeValueWithoutResponse(cmdBytes);
    }

    async start(preset: string = 'p1045', initialPreset?: string) {
        // NOTE: observableCharacteristic already called startNotifications in connect()
        console.log('[Athena] Starting initialization sequence...');

        // Athena startup sequence (from Python implementation)
        // 1. Version check
        console.log('[Athena] Sending version check (v4)...');
        await this.sendCommand('v4');
        await this.delay(100);

        // 2. Status check
        console.log('[Athena] Sending status check (s)...');
        await this.sendCommand('s');
        await this.delay(100);

        // 3. Halt
        console.log('[Athena] Sending halt (h)...');
        await this.sendCommand('h');
        await this.delay(100);

        // 4. Apply initial preset (warm-up) if provided
        if (initialPreset) {
            console.log(`[Athena] Applying initial preset (${initialPreset})...`);
            await this.sendCommand(initialPreset);
            await this.delay(100);
            await this.sendCommand('s');
            await this.delay(100);
        }

        // 5. Apply final preset
        console.log(`[Athena] Applying preset (${preset})...`);
        await this.sendCommand(preset);
        await this.delay(100);
        await this.sendCommand('s');
        await this.delay(100);

        // 6. Start streaming
        console.log('[Athena] Starting data stream (d)...');
        await this.sendCommand('d');
        await this.delay(150);

        // If no data after initial delay, try extended start command
        console.log('[Athena] Trying extended start (dc001) as fallback...');
        await this.sendCommand('dc001');
        await this.delay(50);
        await this.sendCommand('dc001');
        await this.delay(100);

        console.log('[Athena] Stream initialization complete!');
    }

    async stop() {
        try {
            await this.sendCommand('h');
        } catch (e) {
            console.error('Error stopping stream:', e);
        }
    }

    async pause() {
        await this.sendCommand('h');
    }

    async resume() {
        await this.sendCommand('d');
    }

    async deviceInfo(): Promise<MuseDeviceInfo> {
        const resultListener = this.controlResponses.pipe(
            filter((r) => !!r.fw),
            take(1),
        );
        await this.sendCommand('v4');
        return firstValueFrom(resultListener) as Promise<MuseDeviceInfo>;
    }

    async injectMarker(value: string | number, timestamp: number = new Date().getTime()) {
        await this.eventMarkers.next({ value, timestamp });
    }

    disconnect() {
        if (this.gatt) {
            this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
