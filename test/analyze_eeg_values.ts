/**
 * Analyze raw 14-bit EEG values from log files
 * to determine if they use offset binary or two's complement encoding
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From athena-parser.ts
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

interface EEGStats {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    belowMidpoint: number; // Count below 8192
    aboveMidpoint: number; // Count above 8192
    distribution: Map<number, number>; // Range bins
}

function analyzeEEGValues(csvPath: string): EEGStats {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').slice(1); // Skip header

    const allValues: number[] = [];

    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length < 3) continue;

        const hexData = parts[2].trim();
        const bytes = Buffer.from(hexData, 'hex');

        // Find EEG packets (tag 0x12)
        let idx = 0;
        while (idx < bytes.length) {
            const tag = bytes[idx];
            if (tag === 0x12) {
                // EEG packet: skip timestamp (4 bytes), read 28 bytes payload
                const payloadStart = idx + 1 + 4;
                const payloadEnd = payloadStart + 28;

                if (payloadEnd <= bytes.length) {
                    const payload = bytes.subarray(payloadStart, payloadEnd);
                    const values = parseUintLEValues(payload, 14);
                    allValues.push(...values);
                }
                idx = payloadEnd;
            } else {
                idx++;
            }
        }
    }

    if (allValues.length === 0) {
        throw new Error('No EEG values found');
    }

    // Calculate statistics
    const sorted = [...allValues].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    const belowMidpoint = allValues.filter((v) => v < 8192).length;
    const aboveMidpoint = allValues.filter((v) => v >= 8192).length;

    // Distribution: 0-2K, 2K-4K, ..., 14K-16K
    const distribution = new Map<number, number>();
    for (let bin = 0; bin < 8; bin++) {
        distribution.set(bin * 2048, 0);
    }

    for (const val of allValues) {
        const bin = Math.floor(val / 2048) * 2048;
        distribution.set(bin, (distribution.get(bin) || 0) + 1);
    }

    return {
        count: allValues.length,
        min,
        max,
        mean,
        median,
        belowMidpoint,
        aboveMidpoint,
        distribution,
    };
}

// Main
const logFile = path.join(__dirname, 'log_p1045.csv');
console.log(`Analyzing: ${logFile}\n`);

const stats = analyzeEEGValues(logFile);

console.log('=== Raw 14-bit EEG Value Statistics ===\n');
console.log(`Total values: ${stats.count.toLocaleString()}`);
console.log(`Min: ${stats.min} (0x${stats.min.toString(16).toUpperCase()})`);
console.log(`Max: ${stats.max} (0x${stats.max.toString(16).toUpperCase()})`);
console.log(`Mean: ${stats.mean.toFixed(2)}`);
console.log(`Median: ${stats.median}`);
console.log();
console.log(
    `Below midpoint (< 8192): ${stats.belowMidpoint.toLocaleString()} (${((stats.belowMidpoint / stats.count) * 100).toFixed(1)}%)`,
);
console.log(
    `Above midpoint (>= 8192): ${stats.aboveMidpoint.toLocaleString()} (${((stats.aboveMidpoint / stats.count) * 100).toFixed(1)}%)`,
);
console.log();

console.log('=== Distribution ===');
for (const [bin, count] of stats.distribution) {
    const binEnd = bin + 2047;
    const pct = ((count / stats.count) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor((count / stats.count) * 50));
    console.log(
        `${bin.toString().padStart(5)}-${binEnd.toString().padEnd(5)}: ${count.toString().padStart(8)} (${pct.padStart(5)}%) ${bar}`,
    );
}
console.log();

console.log('=== Interpretation ===');
if (stats.min < 2000 && stats.max > 14000) {
    console.log('✓ Values span nearly the full 14-bit range (0-16383)');
    console.log('✓ Mean is near 8192:', stats.mean.toFixed(0), '(expected for offset binary)');
    console.log('→ This confirms OFFSET BINARY encoding: 8192 = 0 µV');
} else if (stats.max < 8192) {
    console.log('✗ Values are mostly in 0-8191 range');
    console.log("→ This would suggest TWO'S COMPLEMENT encoding");
} else {
    console.log('? Mixed distribution - needs further analysis');
}
