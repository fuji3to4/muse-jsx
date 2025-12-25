/**
 * Athena packet decoder for Muse Athena headsets
 * Based on athena_packet_decoder.py protocol
 *
 * Tag-based packet types:
 * - 0x12: EEG (8 channels, 2 samples, 14-bit, 256 Hz)
 * - 0x47: ACC_GYRO (3 samples, 12-bit, 52 Hz)
 * - 0x34: OPTICAL (3 samples, 20-bit, 64 Hz)
 * - 0x98: BATTERY (10 16-bit values, 0.1 Hz)
 */

export interface AthenaEntry {
    type: string; // 'EEG', 'ACC', 'GYRO', 'OPTICAL', 'BATTERY'
    data: number[];
}

export interface AthenaParsedPacket {
    index: number;
    tag: number;
    type: string;
    samples: number;
    entries: AthenaEntry[];
}

/**
 * Convert bytes to bit array (LSB-first per byte)
 */
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
 * Parse unsigned 14-bit little-endian values from bit array
 */
function parseUint14LEValues(buf: Uint8Array): number[] {
    const bits = bytesToBitarray(buf);
    const width = 14;
    const nVals = Math.floor(bits.length / width);
    const out: number[] = [];

    for (let i = 0; i < nVals; i++) {
        let val = 0;
        for (let bitIndex = 0; bitIndex < width; bitIndex++) {
            if (bits[i * width + bitIndex]) {
                val |= 1 << bitIndex;
            }
        }
        out.push(val);
    }
    return out;
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
export function parsePacket(
    data: Uint8Array,
    tag: number,
    tagIndex: number,
    verbose: boolean = false,
): [number, string, AthenaEntry[], number] {
    // After tag byte, skip 4 bytes
    const payloadStart = tagIndex + 1 + 4;

    switch (tag) {
        case 0x12: {
            // EEG: 8 channels x 2 samples, 14-bit at 256 Hz
            const payloadLen = 28;
            const endIndex = payloadStart + payloadLen;
            if (endIndex > data.length) {
                throw new Error(`Not enough data for tag 0x12: need ${endIndex}, have ${data.length}`);
            }

            const block28 = data.subarray(payloadStart, endIndex);
            const values = parseUint14LEValues(block28);

            // Scale 14-bit values to microvolts
            // Following amused-py: EEG_SCALE = 1000.0 / 2048.0 for 12-bit
            // Athena uses 14-bit, so scale proportionally: 1000 / (2^11) = 1000 / 2048 ≈ 0.488 µV/LSB
            // This maintains consistent µV output range across both protocols
            const scaled = values.map((v) => v * (1000 / 2048));

            if (verbose) {
                console.log('EEG:', scaled.slice(0, 8));
                console.log('EEG:', scaled.slice(8, 16));
            }

            return [endIndex, 'EEG', [{ type: 'EEG', data: scaled }], 2];
        }

        case 0x47: {
            // ACC_GYRO: 3 samples x (ACC[3] + GYRO[3]), 12-bit at 52 Hz
            const intsNeeded = 18;
            const bytesNeeded = intsNeeded * 2;
            const endIndex = payloadStart + bytesNeeded;
            if (endIndex > data.length) {
                throw new Error(`Not enough data for tag 0x47: need ${endIndex}, have ${data.length}`);
            }

            const block = data.subarray(payloadStart, endIndex);
            const view = new DataView(block.buffer, block.byteOffset);
            const vals: number[] = [];
            for (let i = 0; i < 18; i++) {
                vals.push(view.getInt16(i * 2, true)); // true = little-endian
            }

            const entries: AthenaEntry[] = [];
            for (let i = 0; i < 3; i++) {
                const base = i * 6;
                const accRaw = vals.slice(base, base + 3);
                const gyroRaw = vals.slice(base + 3, base + 6);

                // Following amused-py IMU scaling:
                // ACCEL_SCALE = 2.0 / 32768.0  (±2G range) ≈ 0.000061 G per LSB
                // GYRO_SCALE = 250.0 / 32768.0 (±250 dps range) ≈ 0.00763 dps per LSB
                const accScaled = accRaw.map((x) => x * (2.0 / 32768.0));
                const gyroScaled = gyroRaw.map((x) => x * (250.0 / 32768.0));

                if (verbose) {
                    console.log(`ACC: ${accScaled}`);
                    console.log(`GYRO: ${gyroScaled}`);
                }

                entries.push({ type: 'ACC', data: accScaled });
                entries.push({ type: 'GYRO', data: gyroScaled });
            }

            return [endIndex, 'ACC_GYRO', entries, 3];
        }

        case 0x34: {
            // OPTICAL: 3 samples x 4x20-bit at 64 Hz
            const bytesNeeded = 30;
            const endIndex = payloadStart + bytesNeeded;
            if (endIndex > data.length) {
                throw new Error(`Not enough data for tag 0x34: need ${endIndex}, have ${data.length}`);
            }

            const block = data.subarray(payloadStart, endIndex);
            const bits = bytesToBitarray(block);

            const entries: AthenaEntry[] = [];
            for (let sample = 0; sample < 3; sample++) {
                const sampleValues: number[] = [];
                for (let value = 0; value < 4; value++) {
                    const bitStart = (sample * 4 + value) * 20;
                    const bitEnd = bitStart + 20;
                    if (bitEnd > bits.length) {
                        throw new Error(`Not enough bits for sample ${sample}, value ${value}`);
                    }

                    const intValue = bitsToInt(bits, bitStart, 20);
                    sampleValues.push(intValue);
                }

                // PPG/Optical uses 20-bit resolution (0-1048575)
                // No specific scaling found in amused-py, keeping raw values
                // Typical PPG analysis works with relative changes, not absolute scale
                if (verbose) {
                    console.log(`Sample ${sample + 1}: ${sampleValues}`);
                }

                entries.push({ type: 'OPTICAL', data: sampleValues });
            }

            return [endIndex, 'OPTICAL', entries, 3];
        }

        case 0x98: {
            // BATTERY: 10x 16-bit unsigned integers at 0.1 Hz
            const bytesNeeded = 20;
            const endIndex = payloadStart + bytesNeeded;
            if (endIndex > data.length) {
                throw new Error(`Not enough data for tag 0x98: need ${endIndex}, have ${data.length}`);
            }

            const block = data.subarray(payloadStart, endIndex);
            const view = new DataView(block.buffer, block.byteOffset);

            const values: number[] = [];
            for (let i = 0; i < 10; i++) {
                // Read as little-endian 16-bit unsigned integers
                const value = view.getUint16(i * 2, true);
                values.push(value);
            }

            // Battery data format is not yet reverse-engineered for Athena
            // Returning raw 10x 16-bit values for future interpretation
            // TODO: Determine correct interpretation when protocol is documented
            if (verbose) {
                console.log(`BATTERY raw: ${values}`);
            }

            return [endIndex, 'BATTERY', [{ type: 'BATTERY', data: values }], 1];
        }

        default: {
            // Unknown tag: consume only the tag byte
            const unknownName = `UNKNOWN_0x${tag.toString(16).toUpperCase().padStart(2, '0')}`;
            if (verbose) {
                console.log(`Unhandled tag 0x${tag.toString(16)}: ${unknownName}`);
            }
            return [tagIndex + 1, unknownName, [], 1];
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
            const [nextIdx, packetName, entries, samples] = parsePacket(data, tag, idx, verbose);

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
