import { channelNames, parsePacket } from './athena-parser';

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

describe('parsePacket', () => {
    it('exports Athena channel names using the existing muse.ts naming style', () => {
        expect(channelNames).toEqual(['TP9', 'AF7', 'AF8', 'TP10', 'AUX_1', 'AUX_2', 'AUX_3', 'AUX_4']);
    });

    it('parses 0x11 EEG packets as 4 channels with 4 samples', () => {
        const eegValues = Array.from({ length: 16 }, (_, index) => 8192 + index);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(1 + 4 + payload.length);

        packet[0] = 0x11;
        packet.set(payload, 5);

        const [, type, entries, samples, freqHz] = parsePacket(packet, 0x11, 0, false);

        expect(type).toBe('EEG');
        expect(samples).toBe(4);
        expect(freqHz).toBe(256);
        expect(entries).toHaveLength(1);
        expect(entries[0].data).toHaveLength(16);
    });

    it('scales Athena EEG values around zero using the offset-binary midpoint', () => {
        const eegValues = new Array(16).fill(8192);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(1 + 4 + payload.length);

        packet[0] = 0x12;
        packet.set(payload, 5);

        const [, type, entries, samples, freqHz] = parsePacket(packet, 0x12, 0, false);

        expect(type).toBe('EEG');
        expect(samples).toBe(2);
        expect(freqHz).toBe(256);
        expect(entries).toHaveLength(1);
        expect(entries[0].data).toHaveLength(16);
        expect(entries[0].data[0]).toBeCloseTo(0, 6);
        expect(entries[0].data[15]).toBeCloseTo(0, 6);
    });

    it('parses 0x88 battery packets from the first two payload bytes and consumes the full payload', () => {
        const payload = new Uint8Array(64);
        payload[0] = 0xae;
        payload[1] = 0x62;
        payload[63] = 0xff;

        const packet = new Uint8Array(1 + 4 + payload.length);
        packet[0] = 0x88;
        packet.set(payload, 5);

        const [nextIdx, type, entries, samples, freqHz] = parsePacket(packet, 0x88, 0, false);

        expect(type).toBe('BATTERY');
        expect(samples).toBe(1);
        expect(freqHz).toBe(0.2);
        expect(nextIdx).toBe(packet.length);
        expect(entries).toEqual([{ type: 'BATTERY', data: [0x62ae / 256] }]);
    });
});
