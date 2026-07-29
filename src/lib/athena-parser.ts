/**
 * Athena packet decoder for Muse Athena headsets
 * Based on athena_packet_decoder.py protocol
 *
 * Tag-based packet types:
 * - 0x11: EEG (4 channels, 4 samples, 14-bit, 256 Hz)
 * - 0x12: EEG (8 channels, 2 samples, 14-bit, 256 Hz)
 * - 0x34: OPTICAL (4ch, 3 samples, 20-bit, 64 Hz)
 * - 0x35: OPTICAL (8ch, 2 samples, 20-bit, 64 Hz)
 * - 0x36: OPTICAL (16ch, 1 sample, 20-bit, 64 Hz)
 * - 0x47: ACC_GYRO (3 samples, 16-bit, 52 Hz)
 * - 0x53: DRL/REF (24-byte payload, 32 Hz)
 * - 0x88: BATTERY / status packet (battery % in first 2 bytes, variable length)
 * - 0x98: BATTERY (old firmware, 20-byte payload, 1 Hz)
 *
 * NOTE: parsePacket() expects tagIndex pointing to the tag byte at the packet header.
 * Use findTaggedPacket() from muse-athena.ts for BLE notification packets with headers.
 */

/**
 * Metadata about the Athena tags based on bitmasks
 */

import {
    MUSE_ATHENA_EEG_SCALE_FACTOR,
    MUSE_ATHENA_ACC_SCALE_FACTOR,
    MUSE_ATHENA_GYRO_SCALE_FACTOR,
    MUSE_ATHENA_OPTICS_SCALE_FACTOR,
    MUSE_ATHENA_BATTERY_SCALE_FACTOR,
    PACKET_HEADER_SIZE,
    SUBPACKET_HEADER_SIZE,
} from './athena-constants';

// const ATHENA_FREQ_MAP: Record<number, number> = {
//     0x0: 0, // Invalid
//     0x1: 256,
//     0x2: 128,
//     0x3: 64,
//     0x4: 52,
//     0x5: 32,
//     0x6: 16,
//     0x7: 10,
//     0x8: 1,
//     0x9: 0.1,
// };

/**
 * Data types from the lower 4 bits of the tag
 */
export enum AthenaDataType {
    INVALID = 0,
    EEG_4CH = 1,
    EEG_8CH = 2,
    DRL_REF = 3,
    OPTICAL_4CH = 4,
    OPTICAL_8CH = 5,
    OPTICAL_16CH = 6,
    IMU = 7,
    BATTERY = 8,
}

export interface AthenaEntry {
    type: string; // 'EEG', 'ACC', 'GYRO', 'OPTICAL', 'BATTERY', 'DRL_REF'
    data: number[];
}

export interface AthenaParsedPacketLegacy {
    index: number;
    tag: number;
    type: string;
    samples: number;
    freqHz: number;
    entries: AthenaEntry[];
}

interface AthenaSensorConfig {
    type: string;
    nChannels: number;
    nSamples: number;
    rate: number;
    dataLen: number;
}

export const channelNames = ['TP9', 'AF7', 'AF8', 'TP10', 'AUX_1', 'AUX_2', 'AUX_3', 'AUX_4'] as const;
export const opticalChannelNames = ['ambient', 'infrared', 'red'] as const;
export const ACCGYRO_CHANNELS = ['ACC_X', 'ACC_Y', 'ACC_Z', 'GYRO_X', 'GYRO_Y', 'GYRO_Z'] as const;
export const OPTICS_CHANNELS = [
    'LO_NIR',
    'RO_NIR',
    'LO_IR',
    'RO_IR',
    'LI_NIR',
    'RI_NIR',
    'LI_IR',
    'RI_IR',
    'LO_RED',
    'RO_RED',
    'LO_AMB',
    'RO_AMB',
    'LI_RED',
    'RI_RED',
    'LI_AMB',
    'RI_AMB',
] as const;

const OPTICS_INDEXES: Record<number, readonly number[]> = {
    4: [0, 1, 2, 3],
    8: [0, 1, 2, 3, 4, 5, 6, 7],
    16: Array.from({ length: 16 }, (_, index) => index),
};

export function selectOpticsChannels(count: number): string[] {
    const indices = OPTICS_INDEXES[count];
    if (!indices) {
        return Array.from({ length: count }, (_, index) => `OPTICS_${index + 1}`);
    }
    return indices.map((index) => OPTICS_CHANNELS[index]);
}

const SENSOR_CONFIG: Record<number, AthenaSensorConfig> = {
    0x11: { type: 'EEG', nChannels: 4, nSamples: 4, rate: 256, dataLen: 28 },
    0x12: { type: 'EEG', nChannels: 8, nSamples: 2, rate: 256, dataLen: 28 },
    0x34: { type: 'OPTICAL', nChannels: 4, nSamples: 3, rate: 64, dataLen: 30 },
    0x35: { type: 'OPTICAL', nChannels: 8, nSamples: 2, rate: 64, dataLen: 40 },
    0x36: { type: 'OPTICAL', nChannels: 16, nSamples: 1, rate: 64, dataLen: 40 },
    0x47: { type: 'ACC_GYRO', nChannels: 6, nSamples: 3, rate: 52, dataLen: 36 },
    0x53: { type: 'DRL_REF', nChannels: 0, nSamples: 2, rate: 32, dataLen: 24 },
    0x88: { type: 'BATTERY', nChannels: 1, nSamples: 1, rate: 0.2, dataLen: 20 },
    0x98: { type: 'BATTERY', nChannels: 1, nSamples: 1, rate: 1, dataLen: 20 },
};

/**
 * Convert bytes to bit array (LSB-first per byte)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function bytesToBitarray(data: Uint8Array): number[] {
    const bits: number[] = [];
    for (const byte of data) {
        for (let i = 0; i < 8; i++) {
            bits.push((byte >> i) & 1);
        }
    }
    return bits;
}

/**
 * Parse unsigned 14-bit little-endian values from buffer using bitwise operations
 */
/**
 * Parse unsigned X-bit little-endian values from buffer
 */
function parseUintLEValues(buf: Uint8Array, bitWidth: number): number[] {
    const nVals = Math.floor((buf.length * 8) / bitWidth);
    const out: number[] = [];

    for (let i = 0; i < nVals; i++) {
        let val = 0;
        for (let bitIndex = 0; bitIndex < bitWidth; bitIndex++) {
            const totalBitOffset = i * bitWidth + bitIndex;
            const byteOffset = Math.floor(totalBitOffset / 8);
            const bitInByte = totalBitOffset % 8;
            if (byteOffset < buf.length) {
                if ((buf[byteOffset] >> bitInByte) & 1) {
                    val |= 1 << bitIndex;
                }
            }
        }
        out.push(val);
    }
    return out;
}

/**
 * Parse signed X-bit little-endian values from buffer
 */
// function parseIntLEValues(buf: Uint8Array, bitWidth: number): number[] {
//     const uints = parseUintLEValues(buf, bitWidth);
//     const maxVal = 1 << bitWidth;
//     const halfVal = 1 << (bitWidth - 1);
//     return uints.map((v) => (v >= halfVal ? v - maxVal : v));
// }

/**
 * Extract bits from bit array and convert to integer (little-endian)
 */
// function bitsToInt(bits: number[], startIdx: number, width: number): number {
//     let val = 0;
//     for (let i = 0; i < width; i++) {
//         if (bits[startIdx + i]) {
//             val |= 1 << i;
//         }
//     }
//     return val;
// }

/**
 * Parse a single packet based on tag
 * Returns: [nextIndex, packetTypeName, entries, samples]
 */
/**
 * Parse a single packet based on tag
 * Returns: [nextIndex, packetTypeName, entries, samples, freqHz]
 */
export function parsePacket(
    data: Uint8Array,
    tag: number,
    tagIndex: number,
    _verbose: boolean = false,
): [number, string, AthenaEntry[], number, number] {
    const payloadStart = tagIndex + 1 + 4;
    const sensor = SENSOR_CONFIG[tag];

    switch (tag) {
        case 0x11:
        case 0x12: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'EEG_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 14);
            const scaled = values.map((v) => v * MUSE_ATHENA_EEG_SCALE_FACTOR);

            return [endIndex, sensor.type, [{ type: sensor.type, data: scaled }], sensor.nSamples, sensor.rate];
        }

        case 0x53: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'DRL_REF_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 14);
            const scaled = values.map((v) => (v - 8192) * MUSE_ATHENA_EEG_SCALE_FACTOR);
            return [endIndex, sensor.type, [{ type: sensor.type, data: scaled }], sensor.nSamples, sensor.rate];
        }

        case 0x47: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'ACC_GYRO_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
            const vals: number[] = [];
            for (let i = 0; i < 18; i++) {
                vals.push(view.getInt16(i * 2, true));
            }

            const entries: AthenaEntry[] = [];
            for (let i = 0; i < 3; i++) {
                const base = i * 6;
                const accScaled = vals.slice(base, base + 3).map((x) => x * MUSE_ATHENA_ACC_SCALE_FACTOR);
                const gyroScaled = vals.slice(base + 3, base + 6).map((x) => x * MUSE_ATHENA_GYRO_SCALE_FACTOR);
                entries.push({ type: 'ACC', data: accScaled });
                entries.push({ type: 'GYRO', data: gyroScaled });
            }

            return [endIndex, sensor.type, entries, sensor.nSamples, sensor.rate];
        }

        case 0x34: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'OPTICAL_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 20);
            const entries: AthenaEntry[] = [];
            for (let s = 0; s < sensor.nSamples; s++) {
                const scaled = values
                    .slice(s * sensor.nChannels, (s + 1) * sensor.nChannels)
                    .map((x) => x * MUSE_ATHENA_OPTICS_SCALE_FACTOR);
                entries.push({ type: 'OPTICAL', data: scaled });
            }

            return [endIndex, sensor.type, entries, sensor.nSamples, sensor.rate];
        }

        case 0x35: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'OPTICAL_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 20);
            const entries: AthenaEntry[] = [];
            for (let s = 0; s < sensor.nSamples; s++) {
                const scaled = values
                    .slice(s * sensor.nChannels, (s + 1) * sensor.nChannels)
                    .map((x) => x * MUSE_ATHENA_OPTICS_SCALE_FACTOR);
                entries.push({ type: 'OPTICAL', data: scaled });
            }

            return [endIndex, sensor.type, entries, sensor.nSamples, sensor.rate];
        }

        case 0x36: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'OPTICAL_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 20);
            const scaled = values.slice(0, sensor.nChannels).map((x) => x * MUSE_ATHENA_OPTICS_SCALE_FACTOR);

            return [endIndex, sensor.type, [{ type: sensor.type, data: scaled }], sensor.nSamples, sensor.rate];
        }

        case 0x88:
        case 0x98: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'BATTERY_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const batteryPercent = (block[0] | (block[1] << 8)) * MUSE_ATHENA_BATTERY_SCALE_FACTOR;
            return [
                endIndex,
                sensor.type,
                [{ type: sensor.type, data: [batteryPercent] }],
                sensor.nSamples,
                sensor.rate,
            ];
        }

        default: {
            const unknownName = `UNKNOWN_0x${tag.toString(16).toUpperCase().padStart(2, '0')}`;
            return [tagIndex + 1, unknownName, [], 1, 0];
        }
    }
}

/**
 * Parse a raw bytes buffer and count packets per type
 */
export function packetParser(
    data: Uint8Array,
    verbose: boolean = false,
    collect: boolean = true,
): [Record<string, { packets: number; samples: number }>, AthenaParsedPacketLegacy[]] {
    const counts: Record<string, { packets: number; samples: number }> = {};
    const parsedPackets: AthenaParsedPacketLegacy[] = [];
    let idx = 0;
    let unknownSuppressed = false;

    while (idx < data.length) {
        const tag = data[idx];

        try {
            const [nextIdx, packetName, entries, samples, freqHz] = parsePacket(data, tag, idx, verbose);

            if (packetName) {
                if (packetName.startsWith('UNKNOWN_0x')) {
                    if (!unknownSuppressed) {
                        const rec = counts[packetName] || { packets: 0, samples: 0 };
                        rec.packets += 1;
                        rec.samples += samples;
                        counts[packetName] = rec;
                        unknownSuppressed = true;
                    }
                } else {
                    const rec = counts[packetName] || { packets: 0, samples: 0 };
                    rec.packets += 1;
                    rec.samples += samples;
                    counts[packetName] = rec;
                    unknownSuppressed = false;
                }

                if (collect) {
                    parsedPackets.push({
                        index: idx,
                        tag,
                        type: packetName,
                        samples,
                        freqHz,
                        entries,
                    });
                }
            }

            if (nextIdx <= idx) {
                idx += 1;
            } else {
                idx = nextIdx;
            }
        } catch (e) {
            if (verbose) {
                console.error(`Error parsing at index ${idx}: ${e}`);
            }
            idx += 1;
        }
    }

    return [counts, parsedPackets];
}

export interface AthenaParsedBlock {
    packageNum: number;
    tag: number;
    type: string;
    entries: AthenaEntry[];
    samples: number;
    freqHz: number;
}

export interface AthenaParsedPacket {
    packetIndex: number;
    blocks: AthenaParsedBlock[];
}

/**
 * Splits a raw BLE notification into its physical Athena packets and parses every
 * primary + subpacket block found. Mirrors BrainFlow's handle_data_notification /
 * parse_sensor_payload dispatch: a notification may contain multiple concatenated
 * physical packets, and an unrecognized or malformed tag aborts only the remainder
 * of the current physical packet rather than the whole notification.
 */
export function parseAthenaNotification(data: Uint8Array): AthenaParsedPacket[] {
    const packets: AthenaParsedPacket[] = [];
    let offset = 0;

    while (offset < data.length) {
        if (data.length - offset < PACKET_HEADER_SIZE) break;

        const packetLen = data[offset];
        if (packetLen < PACKET_HEADER_SIZE || offset + packetLen > data.length) break;

        const packetIndex = data[offset + 1] | (data[offset + 2] << 8);
        const primaryTag = data[offset + 9];
        const primaryBlockIndex = data[offset + 10];
        const packetDataStart = offset + PACKET_HEADER_SIZE;
        const packetDataSize = packetLen - PACKET_HEADER_SIZE;
        let packetDataOffset;
        const blocks: AthenaParsedBlock[] = [];

        const primaryConfig = SENSOR_CONFIG[primaryTag];
        if (primaryConfig && primaryConfig.dataLen > 0 && primaryConfig.dataLen <= packetDataSize) {
            const packageNum = (packetIndex << 8) | primaryBlockIndex;
            const [, type, entries, samples, freqHz] = parsePacket(data, primaryTag, offset + 9, false);
            blocks.push({ packageNum, tag: primaryTag, type, entries, samples, freqHz });
            packetDataOffset = primaryConfig.dataLen;
        } else {
            packetDataOffset = packetDataSize;
        }

        while (packetDataOffset + SUBPACKET_HEADER_SIZE <= packetDataSize) {
            const tagPos = packetDataStart + packetDataOffset;
            const tag = data[tagPos];
            const subpacketIndex = data[tagPos + 1];
            const config = SENSOR_CONFIG[tag];
            if (!config) break;

            const remaining = packetDataSize - packetDataOffset - SUBPACKET_HEADER_SIZE;
            if (config.dataLen === 0 || config.dataLen > remaining) break;

            const packageNum = (packetIndex << 8) | subpacketIndex;
            const [, type, entries, samples, freqHz] = parsePacket(data, tag, tagPos, false);
            blocks.push({ packageNum, tag, type, entries, samples, freqHz });
            packetDataOffset += SUBPACKET_HEADER_SIZE + config.dataLen;
        }

        packets.push({ packetIndex, blocks });
        offset += packetLen;
    }

    return packets;
}
