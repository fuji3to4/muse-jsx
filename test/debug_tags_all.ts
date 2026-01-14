import fs from 'fs';

function findTagsInLog(p: string) {
    console.log(`--- Tags in ${p} ---`);
    const file = `e:/Data/App/EEG/muse-jsx/test/log_${p}.csv`;
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf-8');
    const hex = content.split('\n')[1].split(',')[2];
    const bytes = Buffer.from(hex, 'hex');
    for (let i = 0; i < bytes.length; i++) {
        if ([0x11, 0x12, 0x34, 0x35, 0x47, 0x88].includes(bytes[i])) {
            console.log(`Found 0x${bytes[i].toString(16)} at index ${i}`);
        }
    }
}

findTagsInLog('p1045');
findTagsInLog('p21');
