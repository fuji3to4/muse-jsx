import fs from 'fs';
import path from 'path';

const file = 'e:/Data/App/EEG/muse-jsx/test/log_p1045.csv';
const content = fs.readFileSync(file, 'utf-8');
const lines = content.split('\n');

for (let r = 1; r < 5; r++) {
    const row = lines[r].split(',')[2];
    const bytes = Uint8Array.from(Buffer.from(row, 'hex'));
    console.log(`Row ${r} Total length:`, bytes.length);

    let idx = 9;
    while (idx < bytes.length) {
        const tag = bytes[idx];
        const dataType = tag & 0x0f;
        let payloadLen = 0;

        if (dataType === 1) payloadLen = 14;
        if (dataType === 2) payloadLen = 28;
        if (dataType === 3) payloadLen = 7;
        if (dataType === 4) payloadLen = 30;
        if (dataType === 7) payloadLen = 27;
        if (dataType === 8) payloadLen = 20;

        console.log(`  Idx ${idx}: Tag 0x${tag.toString(16)} (Type ${dataType}, Payload ${payloadLen})`);

        if (payloadLen === 0) {
            console.log(`    Unknown tag 0x${tag.toString(16)} at index ${idx}`);
            break;
        }

        idx += 1 + 4 + payloadLen;
    }
}
