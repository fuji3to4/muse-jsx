import fs from 'fs';
import path from 'path';

const file = 'e:/Data/App/EEG/muse-jsx/test/log_p1045.csv';
const content = fs.readFileSync(file, 'utf-8');
const lines = content.split('\n');

const row = lines[1].split(',')[2];
const bytes = Uint8Array.from(Buffer.from(row, 'hex'));

let idx = 9;
while (idx < bytes.length) {
    const tag = bytes[idx];
    const hdr = bytes.slice(idx + 1, idx + 5);
    const dataType = tag & 0x0f;
    const freqCode = (tag >> 4) & 0x0f;

    console.log(
        `Index ${idx}: Tag 0x${tag.toString(16)} (Freq ${freqCode}, Type ${dataType}) Hdr: ${Buffer.from(hdr).toString('hex')}`,
    );

    // Scan for potential tags manually if we are stuck
    if (dataType > 8 || dataType === 0) {
        console.log('--- SCANNING FOR NEXT TAG ---');
        // A tag usually follows the pattern: TagByte + [4 bytes with high bits set like 0xec or 0x41?]
        // Actually, let's just look at the next 40 bytes.
        console.log(Buffer.from(bytes.slice(idx, idx + 40)).toString('hex'));
        break;
    }

    let payloadLen = 0;
    if (dataType === 1) payloadLen = 14;
    if (dataType === 2) payloadLen = 28;
    if (dataType === 3) payloadLen = 7;
    if (dataType === 4) payloadLen = 30;
    if (dataType === 7) payloadLen = 27;
    if (dataType === 8) payloadLen = 20;

    idx += 1 + 4 + payloadLen;
}
