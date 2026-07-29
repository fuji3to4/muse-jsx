import { channelNames, parsePacket, parseAthenaNotification } from './athena-parser';
import { MUSE_ATHENA_EEG_SCALE_FACTOR, MUSE_ATHENA_BATTERY_SCALE_FACTOR } from './athena-constants';

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

function buildPhysicalPacket(options: {
    packetIndex: number;
    primaryTag: number;
    primaryBlockIndex: number;
    primaryPayload: Uint8Array;
    subpackets?: Array<{ tag: number; index: number; payload: Uint8Array }>;
}): Uint8Array {
    const subpackets = options.subpackets ?? [];
    const subpacketsSize = subpackets.reduce((sum, s) => sum + 5 + s.payload.length, 0);
    const packetLen = 14 + options.primaryPayload.length + subpacketsSize;
    const packet = new Uint8Array(packetLen);

    packet[0] = packetLen;
    packet[1] = options.packetIndex & 0xff;
    packet[2] = (options.packetIndex >> 8) & 0xff;
    packet[9] = options.primaryTag;
    packet[10] = options.primaryBlockIndex;
    packet.set(options.primaryPayload, 14);

    let offset = 14 + options.primaryPayload.length;
    for (const sub of subpackets) {
        packet[offset] = sub.tag;
        packet[offset + 1] = sub.index;
        packet.set(sub.payload, offset + 5);
        offset += 5 + sub.payload.length;
    }

    return packet;
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

    it("scales Athena EEG values using BrainFlow's raw scale factor with no offset subtraction", () => {
        const eegValues = [0, 8192, 16383, 1, ...new Array(12).fill(0)];
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(1 + 4 + payload.length);

        packet[0] = 0x12;
        packet.set(payload, 5);

        const [, type, entries] = parsePacket(packet, 0x12, 0, false);

        expect(type).toBe('EEG');
        expect(entries[0].data[0]).toBeCloseTo(0 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
        expect(entries[0].data[1]).toBeCloseTo(8192 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
        expect(entries[0].data[2]).toBeCloseTo(16383 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
        expect(entries[0].data[3]).toBeCloseTo(1 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
    });

    it('parses 0x88 battery packets from a fixed 20-byte payload, ignoring trailing bytes', () => {
        const payload = new Uint8Array(30);
        payload[0] = 0xae;
        payload[1] = 0x62;
        payload[25] = 0xff; // beyond the fixed 20-byte payload; must not affect parsing

        const packet = new Uint8Array(1 + 4 + payload.length);
        packet[0] = 0x88;
        packet.set(payload, 5);

        const [nextIdx, type, entries, samples, freqHz] = parsePacket(packet, 0x88, 0, false);

        expect(type).toBe('BATTERY');
        expect(samples).toBe(1);
        expect(freqHz).toBe(0.2);
        expect(nextIdx).toBe(5 + 20); // fixed 20-byte payload, not the full 30-byte buffer
        expect(entries).toEqual([{ type: 'BATTERY', data: [0x62ae * MUSE_ATHENA_BATTERY_SCALE_FACTOR] }]);
    });
});

describe('parseAthenaNotification', () => {
    it('parses a single physical packet with a primary EEG tag', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 9,
            primaryTag: 0x12,
            primaryBlockIndex: 3,
            primaryPayload: new Uint8Array(28), // 0x12 fixed payload length
        });

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(1);
        expect(result[0].packetIndex).toBe(9);
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0].type).toBe('EEG');
        expect(result[0].blocks[0].packageNum).toBe((9 << 8) | 3);
    });

    it('splits two physical packets concatenated in one notification', () => {
        const packet1 = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x88,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(20),
        });
        const packet2 = buildPhysicalPacket({
            packetIndex: 2,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const combined = new Uint8Array(packet1.length + packet2.length);
        combined.set(packet1, 0);
        combined.set(packet2, packet1.length);

        const result = parseAthenaNotification(combined);

        expect(result).toHaveLength(2);
        expect(result[0].blocks[0].type).toBe('BATTERY');
        expect(result[1].blocks[0].type).toBe('EEG');
    });

    it('stops parsing when packetLen is invalid', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        packet[0] = 255; // declares far more data than actually present

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(0);
    });

    it('abandons a physical packet with an unrecognized primary tag but still parses the next physical packet', () => {
        const unknownPrimaryPacket = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x7f, // not in SENSOR_CONFIG
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const eegPacket = buildPhysicalPacket({
            packetIndex: 2,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const combined = new Uint8Array(unknownPrimaryPacket.length + eegPacket.length);
        combined.set(unknownPrimaryPacket, 0);
        combined.set(eegPacket, unknownPrimaryPacket.length);

        const result = parseAthenaNotification(combined);

        expect(result).toHaveLength(2);
        expect(result[0].blocks).toHaveLength(0);
        expect(result[1].blocks[0].type).toBe('EEG');
    });

    it('stops the subpacket scan at an unrecognized subpacket tag but keeps earlier subpackets', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x88,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(20),
            subpackets: [
                { tag: 0x47, index: 0, payload: new Uint8Array(36) }, // recognized ACC_GYRO
                { tag: 0x7f, index: 1, payload: new Uint8Array(28) }, // unrecognized -> stop here
                { tag: 0x12, index: 2, payload: new Uint8Array(28) }, // never reached
            ],
        });

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(1);
        expect(result[0].blocks.map((b) => b.type)).toEqual(['BATTERY', 'ACC_GYRO']);
    });

    it('composes a 16-bit packageNum from packetIndex and blockIndex across the 256 boundary', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 511, // 0x1FF -- exercises the byte-1/byte-2 split
            primaryTag: 0x12,
            primaryBlockIndex: 7,
            primaryPayload: new Uint8Array(28),
        });

        const result = parseAthenaNotification(packet);

        expect(result[0].packetIndex).toBe(511);
        expect(result[0].blocks[0].packageNum).toBe((511 << 8) | 7);
    });
});
