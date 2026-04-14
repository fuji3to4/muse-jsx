import { TextDecoder as UtilTextDecoder, TextEncoder as UtilTextEncoder } from 'node:util';
import { DeviceMock, WebBluetoothMock } from 'web-bluetooth-mock';

import { ATHENA_PRESETS, MuseAthenaClient, channelNames } from './muse-athena';

declare const global: any;

function scaleCenteredEeg(value: number) {
    return (value - 8192) * (1450 / 16383);
}

let museDevice: DeviceMock;

function charCodes(s: string) {
    return s.split('').map((c) => c.charCodeAt(0));
}

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

    it('exports OpenMuse-style Athena channel names', () => {
        expect(channelNames).toEqual(['TP9', 'AF7', 'AF8', 'TP10', 'AUX_1', 'AUX_2', 'AUX_3', 'AUX_4']);
    });

    it('includes p1045 in the supported preset list', () => {
        expect(ATHENA_PRESETS).toContain('p1045');
    });

    it('uses p1045 as the default Athena preset', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const controlCharacteristic = service.getCharacteristicMock('273e0001-4c4d-454d-96be-f03bac821358') as any;
        controlCharacteristic.writeValueWithoutResponse = jest.fn();
        jest.spyOn(client as any, 'delay').mockResolvedValue(undefined);

        await client.connect();
        await client.start();

        expect(controlCharacteristic.writeValueWithoutResponse).toHaveBeenCalledWith(
            new Uint8Array([6, ...charCodes('p1045'), 10]),
        );
    });

    it('deinterleaves Athena EEG payloads in sample-major order', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');
        const values = Array.from({ length: 16 }, (_, index) => index + 1);
        const payload = packUnsignedValues(values, 14);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);

        packet[1] = 7;
        packet[9] = 0x12;
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ electrode: number; samples: number[] }> = [];
        client.eegReadings.subscribe((reading) => {
            readings.push({ electrode: reading.electrode, samples: reading.samples });
        });

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        expect(readings).toHaveLength(8);
        expect(readings[0].samples).toEqual([scaleCenteredEeg(1), scaleCenteredEeg(9)]);
        expect(readings[1].samples).toEqual([scaleCenteredEeg(2), scaleCenteredEeg(10)]);
        expect(readings[7].samples).toEqual([scaleCenteredEeg(8), scaleCenteredEeg(16)]);
    });
});
