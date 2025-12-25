/**
 * Muse Athena Client
 * Support for new Athena-based Muse headsets with tag-based packet protocol
 */

import { BehaviorSubject, firstValueFrom, fromEvent, Observable, Subject } from 'rxjs';
import { filter, first, map, share, take, mergeMap } from 'rxjs';

import type {
    AthenaEEGReading,
    AthenaAccGyroSample,
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

// Athena commands (matching Python implementation)
const ATHENA_COMMANDS = {
    v6: new Uint8Array([0x03, 0x76, 0x36, 0x0a]), // Version
    s: new Uint8Array([0x02, 0x73, 0x0a]), // Status
    h: new Uint8Array([0x02, 0x68, 0x0a]), // Halt
    p21: new Uint8Array([0x04, 0x70, 0x32, 0x31, 0x0a]), // Basic preset
    p1034: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x34, 0x0a]), // Sleep preset
    p1035: new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x33, 0x35, 0x0a]), // Sleep preset 2
    dc001: new Uint8Array([0x06, 0x64, 0x63, 0x30, 0x30, 0x31, 0x0a]), // Start streaming
    L1: new Uint8Array([0x03, 0x4c, 0x31, 0x0a]), // L1 command
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

    // Athena streaming observables (compatible with muse.ts)
    rawControlData!: Observable<string>;
    controlResponses!: Observable<MuseControlResponse>;
    eegReadings!: Observable<AthenaEEGReading>; // EEG with channel info
    accGyroReadings!: Observable<AthenaAccGyroSample>; // IMU samples
    opticalReadings!: Observable<AthenaOpticalReading>; // Optical/PPG with channel
    batteryData!: Observable<AthenaBatteryData>;

    eventMarkers: Subject<EventMarker> = new Subject();

    private gatt: BluetoothRemoteGATTServer | null = null;
    private controlChar!: BluetoothRemoteGATTCharacteristic;
    private athenaSensorChar!: BluetoothRemoteGATTCharacteristic;

    // Timestamp tracking (like muse.ts)
    private lastEegIndex: number | null = null;
    private lastEegTimestamp: number | null = null;
    private lastAccGyroIndex: number | null = null;
    private lastAccGyroTimestamp: number | null = null;
    private lastOpticalIndex: number | null = null;
    private lastOpticalTimestamp: number | null = null;

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

        // Athena EEG readings (tag 0x12) - 8 channels x 2 samples each
        this.eegReadings = sensorObservable.pipe(
            mergeMap((packet) => this.parseAthenaEegPacket(packet)),
            share(),
        );

        // Athena ACC/GYRO readings (tag 0x47) - 3 samples each
        this.accGyroReadings = sensorObservable.pipe(
            mergeMap((packet) => this.parseAthenaAccGyroPacket(packet)),
            share(),
        );

        // Athena Optical readings (tag 0x34) - 3 samples each
        this.opticalReadings = sensorObservable.pipe(
            mergeMap((packet) => this.parseAthenaOpticalPacket(packet)),
            share(),
        );

        // Athena Battery data (tag 0x98)
        this.batteryData = sensorObservable.pipe(
            map((packet) => this.parseAthenaBatteryPacket(packet)),
            filter((data) => data !== null),
            map((data) => data as AthenaBatteryData),
            share(),
        );

        this.connectionStatus.next(true);
    }

    private parseAthenaEegPacket(packet: Uint8Array): Observable<AthenaEEGReading> {
        return new Observable((observer) => {
            if (packet.length < 1) {
                observer.complete();
                return;
            }

            const found = this.findTaggedPacket(packet, 0x12);
            if (!found) {
                observer.complete();
                return;
            }

            const [, entries] = found;

            // Collect all EEG samples from entries
            let allSamples: number[] = [];
            for (const entry of entries) {
                if (entry.type === 'EEG') {
                    allSamples = allSamples.concat(entry.data);
                }
            }

            console.log(`[Athena] EEG packet: ${allSamples.length} samples (${allSamples.length / 2} channels x 2)`);

            // Muse Athena has 8 EEG channels, 2 samples each = 16 samples
            // Generate one reading per channel (like muse.ts does)
            const channelNames = ['TP9', 'AF7', 'AF8', 'TP10', 'FPz', 'AUX_R', 'AUX_L', 'AUX'];
            const eventIndex = this.getAthenaEventIndex();

            for (let ch = 0; ch < 8 && ch * 2 < allSamples.length; ch++) {
                const samples = allSamples.slice(ch * 2, ch * 2 + 2);
                if (samples.length === 2) {
                    const timestamp = this.getAthenaTimestamp(eventIndex, 2, 256, 'eeg');
                    observer.next({
                        index: eventIndex,
                        electrode: ch,
                        timestamp,
                        samples,
                    });
                }
            }

            observer.complete();
        });
    }

    private parseAthenaAccGyroPacket(packet: Uint8Array): Observable<AthenaAccGyroSample> {
        return new Observable((observer) => {
            if (packet.length < 1) {
                observer.complete();
                return;
            }

            const found = this.findTaggedPacket(packet, 0x47);
            if (!found) {
                observer.complete();
                return;
            }

            const [, entries] = found;
            const eventIndex = this.getAthenaEventIndex();
            let sampleCount = 0;

            // Parse ACC and GYRO entries
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].type === 'ACC') {
                    const acc = entries[i].data;
                    const gyro =
                        i + 1 < entries.length && entries[i + 1].type === 'GYRO' ? entries[i + 1].data : [0, 0, 0];

                    const timestamp = this.getAthenaTimestamp(eventIndex + sampleCount, 1, 52, 'accgyro');

                    observer.next({
                        index: eventIndex + sampleCount,
                        timestamp,
                        acc: { x: acc[0], y: acc[1], z: acc[2] },
                        gyro: { x: gyro[0], y: gyro[1], z: gyro[2] },
                    });

                    sampleCount++;
                    i++; // Skip the GYRO entry we just processed
                }
            }

            console.log(`[Athena] ACC/GYRO packet: ${sampleCount} samples`);
            observer.complete();
        });
    }

    private parseAthenaOpticalPacket(packet: Uint8Array): Observable<AthenaOpticalReading> {
        return new Observable((observer) => {
            if (packet.length < 1) {
                observer.complete();
                return;
            }

            const found = this.findTaggedPacket(packet, 0x34);
            if (!found) {
                observer.complete();
                return;
            }

            const [, entries] = found;
            const eventIndex = this.getAthenaEventIndex();
            const opticalChannelNames = ['ambient', 'infrared', 'red'];

            // Each OPTICAL entry is one sample with 4 values
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].type === 'OPTICAL') {
                    const samples = entries[i].data;
                    const timestamp = this.getAthenaTimestamp(eventIndex + i, 1, 64, 'optical');

                    observer.next({
                        index: eventIndex + i,
                        opticalChannel: i % 3, // Cycle through 3 channels
                        timestamp,
                        samples,
                    });
                }
            }

            console.log(`[Athena] Optical packet: ${entries.length} samples`);
            observer.complete();
        });
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

    async start(preset: string = 'p1034') {
        // NOTE: observableCharacteristic already called startNotifications in connect()
        console.log('[Athena] Starting initialization sequence');

        // Athena startup sequence (matching Python muse_stream_client.py)
        // 1. Get device info (v6)
        console.log('[Athena] Sending version check (v6)...');
        await this.sendCommand('v6');
        await this.delay(100);

        // 2. Status check
        console.log('[Athena] Sending status check (s)...');
        await this.sendCommand('s');
        await this.delay(100);

        // 3. Halt any existing streams
        console.log('[Athena] Sending halt (h)...');
        await this.sendCommand('h');
        await this.delay(100);

        // 4. Set preset
        console.log(`[Athena] Setting preset (${preset})...`);
        await this.sendCommand(preset);
        await this.delay(100);

        // 5. Start streaming (SEND TWICE!)
        console.log('[Athena] Starting stream (dc001 x2)...');
        await this.sendCommand('dc001');
        await this.delay(50);
        await this.sendCommand('dc001');
        await this.delay(100);

        // 6. Send L1 command
        console.log('[Athena] Sending L1 command...');
        await this.sendCommand('L1');
        await this.delay(100);

        // 7. Wait for streaming to start
        console.log('[Athena] Waiting for stream to start...');
        await this.delay(2000);

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
        console.log('[Athena] Resuming stream (dc001)...');
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
            // Reset timestamp tracking
            this.lastEegIndex = null;
            this.lastEegTimestamp = null;
            this.lastAccGyroIndex = null;
            this.lastAccGyroTimestamp = null;
            this.lastOpticalIndex = null;
            this.lastOpticalTimestamp = null;

            this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private getAthenaEventIndex(): number {
        // Simple monotonically increasing index (in real app, extract from packet)
        return Math.floor(new Date().getTime() / 10);
    }

    private getAthenaTimestamp(
        eventIndex: number,
        samplesPerReading: number,
        frequency: number,
        dataType: 'eeg' | 'accgyro' | 'optical',
    ): number {
        const READING_DELTA = 1000 * (1.0 / frequency) * samplesPerReading;

        // Use appropriate last index/timestamp for each type
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

        if (lastIndex === null || lastTimestamp === null) {
            lastIndex = eventIndex;
            lastTimestamp = new Date().getTime() - READING_DELTA;
        }

        // Handle wrap around (like muse.ts)
        while (lastIndex - eventIndex > 0x1000) {
            eventIndex += 0x10000;
        }

        let newTimestamp = lastTimestamp;
        if (eventIndex > lastIndex) {
            newTimestamp += READING_DELTA * (eventIndex - lastIndex);
        }

        // Update tracking for this type
        if (dataType === 'eeg') {
            this.lastEegIndex = eventIndex;
            this.lastEegTimestamp = newTimestamp;
        } else if (dataType === 'accgyro') {
            this.lastAccGyroIndex = eventIndex;
            this.lastAccGyroTimestamp = newTimestamp;
        } else {
            this.lastOpticalIndex = eventIndex;
            this.lastOpticalTimestamp = newTimestamp;
        }

        return newTimestamp;
    }
}
