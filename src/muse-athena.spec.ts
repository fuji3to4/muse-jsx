import { TextDecoder as UtilTextDecoder, TextEncoder as UtilTextEncoder } from 'node:util';
import { DeviceMock, WebBluetoothMock } from 'web-bluetooth-mock';

import { ATHENA_PRESETS, MuseAthenaClient, channelNames, selectOpticsChannels } from './muse-athena';

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
        const sendSpy = jest.spyOn(MuseAthenaClient.prototype as any, 'sendCommand').mockResolvedValue(undefined);
        const delaySpy = jest
            .spyOn(MuseAthenaClient.prototype as any, 'delay')
            .mockImplementation(() => Promise.resolve());

        await client.start();

        const calledWithPreset = sendSpy.mock.calls.some((c: any[]) => c[0] === 'p1045');
        expect(calledWithPreset).toBe(true);

        sendSpy.mockRestore();
        delaySpy.mockRestore();
    });

    it('deinterleaves EEG samples into channel readings', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

        // Create 8 channels * 2 samples = 16 sequential 14-bit values
        const eegValues = Array.from({ length: 16 }, (_, i) => i + 1);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);
        packet[1] = 9;
        packet[9] = 0x12; // 8-channel EEG tag
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; electrode: number; samples: number[] }> = [];
        client.eegReadings.subscribe((r) =>
            readings.push({ index: r.index, electrode: (r as any).electrode, samples: r.samples }),
        );

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        // Expect one reading per channel (8 channels) with 2 samples each
        expect(readings).toHaveLength(8);
        for (const r of readings) {
            expect(r.samples.length).toBe(2);
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
    });
});
