/**
 * Athena packet decoder for Muse Athena headsets
 * Based on athena_packet_decoder.py protocol
 *
 * Tag-based packet types:
 * - 0x12: EEG (8 channels, 2 samples, 14-bit, 256 Hz)
 * - 0x47: ACC_GYRO (3 samples, 12-bit, 52 Hz)
 * - 0x34: OPTICAL (3 samples, 20-bit, 64 Hz)
 * - 0x88: BATTERY (10 16-bit values, 1 Hz)  [firmware update: was 0x98]
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
    verbose: boolean = false,
): [number, string, AthenaEntry[], number, number] {
    const payloadStart = tagIndex + 1 + 4;

    switch (tag) {
        case 0x11:
        case 0x12: {
            // EEG (4ch/8ch): 8 channels x 2 samples (interleaved or padded), 14-bit
            // Even 4ch seems to use 33-byte blocks in p21 logs
            const payloadLen = 28;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'EEG_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 14);
            // Scale 14-bit values to microvolts and center at 0
            // Offset binary: 8192 is the center (0 uV)
            // MuseAthenaDataformatParser uses 1450 µV for full scale (2^14 - 1 = 16383)
            // Scaling: 1450 uV / 16384 LSB approx 0.0885
            const scaled = values.map((v) => (v - 8192) * 0.0885);

            return [endIndex, 'EEG', [{ type: 'EEG', data: scaled }], 2, 256];
        }

        case 0x53: {
            // DRL/REF
            const payloadLen = 7;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'DRL_REF_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 14);
            const scaled = values.map((v) => (v - 8192) * 0.0885);
            return [endIndex, 'DRL_REF', [{ type: 'DRL_REF', data: scaled }], 2, 32];
        }

        case 0x47: {
            // IMU: 3 samples x (ACC[3] + GYRO[3]), 16-bit (verified via alignment)
            const payloadLen = 36;
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
                // Following amused-py IMU scaling (MuseAthenaDataformatParser uses this scaling)
                // ACCEL_SCALE = 2.0 / 32768(=2^15)  (±2G range) ≈ 0.000061 G per LSB
                // GYRO_SCALE = 250.0 / 32768(=2^15) (±250 dps range) ≈ 0.00763 dps per LSB
                const accScaled = vals.slice(base, base + 3).map((x) => x * 0.0000610352);
                const gyroScaled = vals.slice(base + 3, base + 6).map((x) => x * -0.0074768);
                entries.push({ type: 'ACC', data: accScaled });
                entries.push({ type: 'GYRO', data: gyroScaled });
            }

            return [endIndex, 'ACC_GYRO', entries, 3, 52];
        }

        case 0x34:
        case 0x35: {
            // OPTICAL: 3 samples x 4ch x 20-bit
            const payloadLen = 30;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'OPTICAL_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 20);
            const entries: AthenaEntry[] = [];
            for (let s = 0; s < 3; s++) {
                const scaled = values.slice(s * 4, (s + 1) * 4).map((x) => x / 32768);
                entries.push({ type: 'OPTICAL', data: scaled });
            }

            return [endIndex, 'OPTICAL', entries, 3, 64];
        }

        case 0x88:
        case 0x98: {
            // BATTERY: 20 bytes payload
            const payloadLen = 20;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) return [tagIndex + 1, 'BATTERY_PARTIAL', [], 1, 0];

            const block = data.subarray(payloadStart, endIndex);
            const values = parseUintLEValues(block, 16);
            return [endIndex, 'BATTERY', [{ type: 'BATTERY', data: values }], 1, 1];
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
