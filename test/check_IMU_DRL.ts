import fs from 'fs';
import path from 'path';

const file = 'e:/Data/App/EEG/muse-jsx/test/log_p1045.csv';
const content = fs.readFileSync(file, 'utf-8');
const lines = content.split('\n');

const row = lines[1].split(',')[2];
const bytes = Uint8Array.from(Buffer.from(row, 'hex'));

let idx = 141; // Start at 1st IMU
while (idx < bytes.length) {
    const tag = bytes[idx];
    console.log(`Idx ${idx}: Tag 0x${tag.toString(16)}`);

    let payloadLen = 0;
    if ((tag & 0x0f) === 7)
        payloadLen = 27; // IMU
    else if ((tag & 0x0f) === 3)
        payloadLen = 7; // DRL/REF
    else if ((tag & 0x0f) === 2)
        payloadLen = 28; // EEG 8ch
    else if ((tag & 0x0f) === 4) payloadLen = 30; // OPTICAL 4ch

    if (payloadLen === 0) {
        console.log('  STUCK at', Buffer.from(bytes.slice(idx, idx + 10)).toString('hex'));
        break;
    }
    idx += 1 + 4 + payloadLen;
}
