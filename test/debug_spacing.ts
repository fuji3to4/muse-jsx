import fs from 'fs';
import path from 'path';

const file = 'e:/Data/App/EEG/muse-jsx/test/log_p1045.csv';
const content = fs.readFileSync(file, 'utf-8');
const lines = content.split('\n');
const row2 = lines[1].split(',')[2];
const bytes = Uint8Array.from(Buffer.from(row2, 'hex'));

console.log('Total length:', bytes.length);

let idx = 9;
while (idx < bytes.length) {
    const tag = bytes[idx];
    const hdr = bytes.slice(idx + 1, idx + 5);
    console.log(`Index ${idx}: Tag 0x${tag.toString(16)} (SubHdr: ${Buffer.from(hdr).toString('hex')})`);

    // Find next tag by looking for known patterns or just scanning?
    // Let's assume our current lengths and see where we land.
    const dataType = tag & 0x0f;
    let len = 0;
    if (dataType === 1) len = 14; // EEG 4ch
    if (dataType === 2) len = 28; // EEG 8ch
    if (dataType === 3) len = 7; // DRL/REF?
    if (dataType === 4) len = 30; // OPT 4ch
    if (dataType === 7) len = 27; // IMU?
    if (dataType === 8) len = 20; // Battery

    if (len === 0) {
        console.log('  Unknown tag type, stopping.');
        break;
    }

    idx += 1 + 4 + len;
}
