import fs from 'fs';

const content = fs.readFileSync('e:/Data/App/EEG/muse-jsx/test/log_p1045.csv', 'utf-8');
const hex = content.split('\n')[1].split(',')[2];
const bytes = Buffer.from(hex, 'hex');

for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ([0x11, 0x12, 0x34, 0x35, 0x47, 0x68, 0x88].includes(b)) {
        console.log(`Byte ${i}: 0x${b.toString(16)} (Char range ${i * 2}-${i * 2 + 2})`);
    }
}
