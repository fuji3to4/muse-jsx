import { TextDecoder as UtilTextDecoder, TextEncoder as UtilTextEncoder } from 'node:util';
import { DeviceMock, WebBluetoothMock } from 'web-bluetooth-mock';

import { ATHENA_PRESETS, MuseAthenaClient, channelNames, selectOpticsChannels } from './muse-athena';
import { MUSE_ATHENA_EEG_SCALE_FACTOR, MUSE_ATHENA_OPTICS_SCALE_FACTOR } from './lib/athena-constants';

declare const global: any;

function packUnsignedValues(values: number[], bitWidth: number): Uint8Array {
    const totalBits = values.length * bitWidth;
    const out = new Uint8Array(Math.ceil(totalBits / 8));

    values.forEach((value, valueIndex) => {
        for (let bitIndex = 0; bitIndex < bitWidth; bitIndex++) {
            if ((value >> bitIndex) & 1) {
                const totalBitOffset = valueIndex * bitWidth + bitIndex;
                const byteOffset = Math.floor(totalBitOffset / 8);
                const bitInByte = totalBitOffset % 8;
                out[byteOffset] |= 1 << bitInByte;
            }
        }
    });

    return out;
}

describe('MuseAthenaClient', () => {
    let museDevice: DeviceMock;

    beforeEach(() => {
        museDevice = new DeviceMock('Muse-Test', [0xfe8d]);
        global.navigator = global.navigator || {};
        global.navigator.bluetooth = new WebBluetoothMock([museDevice]);
        if (typeof global.TextEncoder === 'undefined') {
            global.TextEncoder = UtilTextEncoder as any;
        }
        if (typeof global.TextDecoder === 'undefined') {
            global.TextDecoder = UtilTextDecoder as any;
        }
    });

    it('exports channel names for EEG electrodes', () => {
        expect(channelNames).toEqual(['TP9', 'AF7', 'AF8', 'TP10', 'AUX_1', 'AUX_2', 'AUX_3', 'AUX_4']);
    });

    it('exports ATHENA_PRESETS and includes default preset', () => {
        expect(Array.isArray(ATHENA_PRESETS)).toBe(true);
        expect(ATHENA_PRESETS).toContain('p1045');
    });

    it('uses default preset when starting', async () => {
        const client = new MuseAthenaClient();
        const delaySpy = jest
            .spyOn(MuseAthenaClient.prototype as any, 'delay')
            .mockImplementation(() => Promise.resolve());

        // Use the service/characteristic mock directly (web-bluetooth-mock) instead of spying on
        // the characteristic returned by the connected client instance.
        const service = museDevice.getServiceMock(0xfe8d);
        const controlCharacteristic = service.getCharacteristicMock('273e0001-4c4d-454d-96be-f03bac821358');
        // Ensure the mock exposes the writeValueWithoutResponse method so we can assert calls.
        (controlCharacteristic as any).writeValueWithoutResponse = jest.fn().mockResolvedValue(undefined);

        try {
            await client.connect();
            await client.start();

            const expected = new Uint8Array([0x06, 0x70, 0x31, 0x30, 0x34, 0x35, 0x0a]);
            const calledWith = ((controlCharacteristic as any).writeValueWithoutResponse as jest.Mock).mock.calls.some(
                (c: any[]) => {
                    const arg = c[0] as Uint8Array;
                    if (!arg) return false;
                    if (arg.length !== expected.length) return false;
                    for (let i = 0; i < arg.length; i++) if ((arg as any)[i] !== (expected as any)[i]) return false;
                    return true;
                },
            );
            expect(calledWith).toBe(true);
        } finally {
            delaySpy.mockRestore();
        }
    });

    it('deinterleaves EEG samples into channel readings', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

        // Create 8 channels * 2 samples = 16 sequential 14-bit values
        const eegValues = Array.from({ length: 16 }, (_, i) => i + 1);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);
        packet[0] = packet.length; // packetLen framing byte required by parseAthenaNotification
        packet[1] = 9;
        packet[9] = 0x12; // 8-channel EEG tag
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; electrode: number; samples: number[] }> = [];
        client.eegReadings.subscribe((r) =>
            readings.push({ index: r.index, electrode: r.electrode, samples: r.samples }),
        );

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        // Expect one reading per channel (8 channels) with 2 samples each and verify scaling + ordering
        expect(readings).toHaveLength(8);
        for (let i = 0; i < 8; i++) {
            const r = readings[i];
            expect(r.electrode).toBe(i);
            expect(r.samples.length).toBe(2);
            const v0 = (i + 1) * MUSE_ATHENA_EEG_SCALE_FACTOR;
            const v1 = (i + 1 + 8) * MUSE_ATHENA_EEG_SCALE_FACTOR;
            expect(r.samples[0]).toBeCloseTo(v0, 5);
            expect(r.samples[1]).toBeCloseTo(v1, 5);
        }
    });

    it('exports Athena optical labels for 8-channel optical packets', () => {
        expect(selectOpticsChannels(8)).toEqual([
            'LO_NIR',
            'RO_NIR',
            'LO_IR',
            'RO_IR',
            'LI_NIR',
            'RI_NIR',
            'LI_IR',
            'RI_IR',
        ]);
    });

    it('emits Athena optical readings with one value per optical sensor', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');
        const opticalValues = Array.from({ length: 16 }, (_, index) => index + 1);
        const payload = packUnsignedValues(opticalValues, 20);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);

        packet[0] = packet.length; // packetLen framing byte required by parseAthenaNotification
        packet[1] = 9;
        packet[9] = 0x35;
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; samples: number[] }> = [];
        client.opticalReadings.subscribe((reading) => {
            readings.push({ index: reading.index, samples: reading.samples });
        });

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        expect(readings).toHaveLength(2);
        expect(readings[0].samples).toHaveLength(8);
        expect(readings[1].samples).toHaveLength(8);

        // First reading should contain values 1..8 (scale factor is 1.0 -- no-op)
        for (let i = 0; i < 8; i++) {
            expect(readings[0].samples[i]).toBeCloseTo((i + 1) * MUSE_ATHENA_OPTICS_SCALE_FACTOR, 8);
        }
        // Second reading should contain values 9..16
        for (let i = 0; i < 8; i++) {
            expect(readings[1].samples[i]).toBeCloseTo((i + 9) * MUSE_ATHENA_OPTICS_SCALE_FACTOR, 8);
        }
    });

    describe('getPacketBaseTimestamp', () => {
        it('backdates from current time on the first packet (last === null)', () => {
            const client = new MuseAthenaClient() as any;
            const result = client.getPacketBaseTimestamp(null, 1000, 4, 256);
            expect(result).toBeCloseTo(1000 - (3 * 1000) / 256, 6);
        });

        it('returns current time when the clock has not advanced (stale/duplicate)', () => {
            const client = new MuseAthenaClient() as any;
            const result = client.getPacketBaseTimestamp(1000, 1000, 4, 256);
            expect(result).toBe(1000);
        });

        it('interpolates forward from last timestamp by a full packet worth of samples at the nominal rate', () => {
            const client = new MuseAthenaClient() as any;
            // nominal step for a 4-sample packet at 256Hz is (4*1000)/256 ~= 15.6ms
            const result = client.getPacketBaseTimestamp(1000, 1100, 4, 256);
            expect(result).toBeCloseTo(1000 + (4 * 1000) / 256, 6);
        });

        it('spreads evenly across the actual elapsed interval when arrival is faster than nominal', () => {
            const client = new MuseAthenaClient() as any;
            // nominal step for a 4-sample packet at 256Hz is (4*1000)/256 ~= 15.6ms, but only 2ms actually elapsed
            const result = client.getPacketBaseTimestamp(1000, 1002, 4, 256);
            expect(result).toBeCloseTo(1000 + (1002 - 1000) / 4, 6);
        });

        it('force-resyncs to current time when the gap since the last packet exceeds 1 second', () => {
            const client = new MuseAthenaClient() as any;
            // a 1500ms gap implies a real disconnect/stall, not just BLE jitter -- treat it like a fresh start
            const result = client.getPacketBaseTimestamp(1000, 2500, 4, 256);
            expect(result).toBeCloseTo(2500 - (3 * 1000) / 256, 6);
        });
    });

    describe('timestamp reset lifecycle', () => {
        it('resets all three timestamp fields to null', () => {
            const client = new MuseAthenaClient() as any;
            client.lastEegTimestamp = 123;
            client.lastAccGyroTimestamp = 456;
            client.lastOpticalTimestamp = 789;

            client.resetTimestampState();

            expect(client.lastEegTimestamp).toBeNull();
            expect(client.lastAccGyroTimestamp).toBeNull();
            expect(client.lastOpticalTimestamp).toBeNull();
        });

        it('resets all three per-sensor-type index counters to zero', () => {
            const client = new MuseAthenaClient() as any;
            client.eegIndexCounter = 7;
            client.accGyroIndexCounter = 3;
            client.opticalIndexCounter = 9;

            client.resetTimestampState();

            expect(client.eegIndexCounter).toBe(0);
            expect(client.accGyroIndexCounter).toBe(0);
            expect(client.opticalIndexCounter).toBe(0);
        });

        it('resets timestamp state on start, pause, resume, and stop', async () => {
            const client = new MuseAthenaClient();
            const delaySpy = jest
                .spyOn(MuseAthenaClient.prototype as any, 'delay')
                .mockImplementation(() => Promise.resolve());
            const resetSpy = jest.spyOn(MuseAthenaClient.prototype as any, 'resetTimestampState');
            const service = museDevice.getServiceMock(0xfe8d);
            const controlCharacteristic = service.getCharacteristicMock('273e0001-4c4d-454d-96be-f03bac821358');
            (controlCharacteristic as any).writeValueWithoutResponse = jest.fn().mockResolvedValue(undefined);

            try {
                await client.connect();
                await client.start();
                expect(resetSpy).toHaveBeenCalledTimes(1);

                await client.pause();
                expect(resetSpy).toHaveBeenCalledTimes(2);

                await client.resume();
                expect(resetSpy).toHaveBeenCalledTimes(3);

                await client.stop();
                expect(resetSpy).toHaveBeenCalledTimes(4);
            } finally {
                delaySpy.mockRestore();
                resetSpy.mockRestore();
            }
        });

        it('resets timestamp state on disconnect', async () => {
            const client = new MuseAthenaClient();
            const resetSpy = jest.spyOn(MuseAthenaClient.prototype as any, 'resetTimestampState');

            try {
                await client.connect();
                resetSpy.mockClear();
                client.disconnect();
                expect(resetSpy).toHaveBeenCalledTimes(1);
            } finally {
                resetSpy.mockRestore();
            }
        });
    });

    describe('per-sensor-type index counters', () => {
        it('increments the EEG index by 1 per EEG block, unaffected by interleaved ACC_GYRO packets', async () => {
            const client = new MuseAthenaClient();
            const service = museDevice.getServiceMock(0xfe8d);
            const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

            await client.connect();

            const eegIndexes: number[] = [];
            client.eegReadings.subscribe((r) => {
                if (r.electrode === 0) eegIndexes.push(r.index);
            });

            const eegValues = new Array(16).fill(8192);
            const eegPayload = packUnsignedValues(eegValues, 14);
            const buildEegPacket = (packetIndex: number) => {
                const packet = new Uint8Array(14 + eegPayload.length);
                packet[0] = packet.length;
                packet[1] = packetIndex & 0xff;
                packet[2] = (packetIndex >> 8) & 0xff;
                packet[9] = 0x12;
                packet.set(eegPayload, 14);
                return packet;
            };

            const accGyroPayload = new Uint8Array(36);
            const buildAccGyroPacket = (packetIndex: number) => {
                const packet = new Uint8Array(14 + accGyroPayload.length);
                packet[0] = packet.length;
                packet[1] = packetIndex & 0xff;
                packet[2] = (packetIndex >> 8) & 0xff;
                packet[9] = 0x47;
                packet.set(accGyroPayload, 14);
                return packet;
            };

            // Simulate a real BLE stream: EEG, ACC_GYRO (unrelated sensor), EEG, EEG.
            // The EEG index sequence must stay 0,1,2 -- unaffected by the ACC_GYRO packet
            // in between, unlike the old shared packageNum-derived index.
            for (const packet of [buildEegPacket(1), buildAccGyroPacket(2), buildEegPacket(3), buildEegPacket(4)]) {
                sensorCharacteristic.value = new DataView(packet.buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));
            }

            expect(eegIndexes).toEqual([0, 1, 2]);
        });

        it('resets the per-sensor-type index counters on start/stop/pause/resume/disconnect', async () => {
            const client = new MuseAthenaClient();
            const service = museDevice.getServiceMock(0xfe8d);
            const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');
            const controlCharacteristic = service.getCharacteristicMock('273e0001-4c4d-454d-96be-f03bac821358');
            (controlCharacteristic as any).writeValueWithoutResponse = jest.fn().mockResolvedValue(undefined);
            const delaySpy = jest
                .spyOn(MuseAthenaClient.prototype as any, 'delay')
                .mockImplementation(() => Promise.resolve());

            try {
                await client.connect();

                const eegIndexes: number[] = [];
                client.eegReadings.subscribe((r) => {
                    if (r.electrode === 0) eegIndexes.push(r.index);
                });

                const eegValues = new Array(16).fill(8192);
                const eegPayload = packUnsignedValues(eegValues, 14);
                const buildEegPacket = () => {
                    const packet = new Uint8Array(14 + eegPayload.length);
                    packet[0] = packet.length;
                    packet[1] = 1;
                    packet[9] = 0x12;
                    packet.set(eegPayload, 14);
                    return packet;
                };

                sensorCharacteristic.value = new DataView(buildEegPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                await client.start();

                sensorCharacteristic.value = new DataView(buildEegPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                expect(eegIndexes).toEqual([0, 0]);
            } finally {
                delaySpy.mockRestore();
            }
        });
    });

    describe('EEG packet timestamps', () => {
        it('anchors to real arrival time instead of a fixed-rate counter', async () => {
            const client = new MuseAthenaClient();
            const service = museDevice.getServiceMock(0xfe8d);
            const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

            await client.connect();

            const timestamps: number[] = [];
            client.eegReadings.subscribe((r) => {
                if (r.electrode === 0) timestamps.push(r.timestamp);
            });

            const eegValues = new Array(16).fill(8192);
            const payload = packUnsignedValues(eegValues, 14);
            const buildPacket = () => {
                const packet = new Uint8Array(14 + payload.length);
                packet[0] = packet.length;
                packet[1] = 1;
                packet[9] = 0x12;
                packet.set(payload, 14);
                return packet;
            };

            const nowSpy = jest.spyOn(Date, 'now');
            try {
                nowSpy.mockReturnValueOnce(1_000_000);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                // 50ms later -- far more than one nominal 2-sample EEG step (~7.8ms)
                nowSpy.mockReturnValueOnce(1_000_050);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                // another 50ms of real-world lag
                nowSpy.mockReturnValueOnce(1_000_100);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));
            } finally {
                nowSpy.mockRestore();
            }

            expect(timestamps).toHaveLength(3);
            // n_samples=2 for tag 0x12 -> backdate by (2-1)/256 seconds on the first packet
            expect(timestamps[0]).toBeCloseTo(1_000_000 - 1000 / 256, 6);
            // second packet advances by a full 2-sample nominal step from the first packet's
            // computed timestamp, not from the real (late) arrival time of 1_000_050
            expect(timestamps[1]).toBeCloseTo(1_000_000 + 1000 / 256, 6);
            // third packet keeps advancing at the nominal rate from the second packet's
            // computed timestamp -- BLE arrival lag does not accumulate as permanent drift
            expect(timestamps[2]).toBeCloseTo(timestamps[1] + (2 * 1000) / 256, 6);
        });

        it('resyncs to real time after a gap long enough to imply a real stall, not just BLE jitter', async () => {
            const client = new MuseAthenaClient();
            const service = museDevice.getServiceMock(0xfe8d);
            const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

            await client.connect();

            const timestamps: number[] = [];
            client.eegReadings.subscribe((r) => {
                if (r.electrode === 0) timestamps.push(r.timestamp);
            });

            const eegValues = new Array(16).fill(8192);
            const payload = packUnsignedValues(eegValues, 14);
            const buildPacket = () => {
                const packet = new Uint8Array(14 + payload.length);
                packet[0] = packet.length;
                packet[1] = 1;
                packet[9] = 0x12;
                packet.set(payload, 14);
                return packet;
            };

            const nowSpy = jest.spyOn(Date, 'now');
            try {
                nowSpy.mockReturnValueOnce(1_000_000);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                // 2s later -- a real stall/disconnect, not routine BLE jitter
                nowSpy.mockReturnValueOnce(1_002_000);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));
            } finally {
                nowSpy.mockRestore();
            }

            expect(timestamps).toHaveLength(2);
            expect(timestamps[1]).toBeCloseTo(1_002_000 - 1000 / 256, 6);
        });
    });
});
