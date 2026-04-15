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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ATHENA_FREQ_MAP: Record<number, number> = {
    0x0: 0, // Invalid
    0x1: 256,
    0x2: 128,
    0x3: 64,
    0x4: 52,
    0x5: 32,
    0x6: 16,
    0x7: 10,
    0x8: 1,
    0x9: 0.1,
};

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

export interface AthenaParsedPacket {
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

const EEG_SCALE = 1450 / 16383;
const ACC_SCALE = 0.0000610352;
const GYRO_SCALE = -0.0074768;
const OPTICS_SCALE = 1 / 32768;

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
    4: [4, 5, 6, 7],
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
    0x88: { type: 'BATTERY', nChannels: 1, nSamples: 1, rate: 0.2, dataLen: 188 },
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
function parseIntLEValues(buf: Uint8Array, bitWidth: number): number[] {
    const uints = parseUintLEValues(buf, bitWidth);
    const maxVal = 1 << bitWidth;
    const halfVal = 1 << (bitWidth - 1);
    return uints.map((v) => (v >= halfVal ? v - maxVal : v));
}

/**
 * Extract bits from bit array and convert to integer (little-endian)
 */
function bitsToInt(bits: number[], startIdx: number, width: number): number {
    let val = 0;
    for (let i = 0; i < width; i++) {
        if (bits[startIdx + i]) {
            val |= 1 << i;
        }
    }
    return val;
}

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
            // Align Athena EEG scaling with OpenMuse / MuseAthenaDataformatParser.
            // Scale 14-bit values to microvolts and center at 0
            // Offset binary: 8192 (=2^14/2) is the center (0 uV)
            // MuseAthenaDataformatParser uses 1450 µV for full scale (2^14 - 1 = 16383)
            // Scaling: 1450 uV / 16383 LSB approx 0.0885
            const scaled = values.map((v) => (v - 8192) * EEG_SCALE);

            return [endIndex, sensor.type, [{ type: sensor.type, data: scaled }], sensor.nSamples, sensor.rate];
        }

        case 0x53: {
            const payloadLen = sensor.dataLen;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'DRL_REF_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 14);
            const scaled = values.map((v) => (v - 8192) * EEG_SCALE);
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
                const accScaled = vals.slice(base, base + 3).map((x) => x * ACC_SCALE);
                const gyroScaled = vals.slice(base + 3, base + 6).map((x) => x * GYRO_SCALE);
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
                    .map((x) => x * OPTICS_SCALE);
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
                    .map((x) => x * OPTICS_SCALE);
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
            const scaled = values.slice(0, sensor.nChannels).map((x) => x * OPTICS_SCALE);

            return [endIndex, sensor.type, [{ type: sensor.type, data: scaled }], sensor.nSamples, sensor.rate];
        }

        case 0x88:
        case 0x98: {
            // Newer Athena firmware sends a long status packet where the first 2 bytes
            // contain state-of-charge in 1/256 percent units.
            const endIndex = data.length;
            if (payloadStart + 2 > endIndex) return [tagIndex + 1, 'BATTERY_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const batteryPercent = (block[0] | (block[1] << 8)) / 256;
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
): [Record<string, { packets: number; samples: number }>, AthenaParsedPacket[]] {
    const counts: Record<string, { packets: number; samples: number }> = {};
    const parsedPackets: AthenaParsedPacket[] = [];
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
