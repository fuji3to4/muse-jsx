import fs from 'fs';
import path from 'path';

const file = 'e:/Data/App/EEG/muse-jsx/test/log_p1045.csv';
const content = fs.readFileSync(file, 'utf-8');
const lines = content.split('\n');

const row = lines[1].split(',')[2];
const bytes = Uint8Array.from(Buffer.from(row, 'hex'));

console.log('Searching for known tags (11, 12, 34, 35, 47, 53, 88)...');

for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ([0x11, 0x12, 0x34, 0x35, 0x47, 0x53, 0x88].includes(b)) {
        const next4 = bytes.slice(i + 1, i + 5);
        // Heuristic: sub-headers often have high bits set in first byte (e.g. 0xec, 0x41)
        console.log(`Found 0x${b.toString(16)} at index ${i}. SubHdr: ${Buffer.from(next4).toString('hex')}`);
    }
}
