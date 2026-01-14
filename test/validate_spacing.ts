import fs from 'fs';

function checkLog(p: string) {
    console.log(`--- Checking ${p} ---`);
    const file = `e:/Data/App/EEG/muse-jsx/test/log_${p}.csv`;
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
        const hex = lines[i].split(',')[2];
        if (!hex) continue;
        const bytes = Buffer.from(hex, 'hex');
        const tag = bytes[9];
        console.log(`Row ${i}: Tag at 9 is 0x${tag.toString(16)}. Total len ${bytes.length}`);

        let payloadLen = 0;
        if (tag === 0x11) payloadLen = 14;
        if (tag === 0x12) payloadLen = 21; // Wait, let's see. 8ch * 2 samples * 14 bits / 8 = 28?
        if (tag === 0x12) payloadLen = 28;
        if (tag === 0x47) payloadLen = 36;
        if (tag === 0x34) payloadLen = 30;
        if (tag === 0x88) payloadLen = 20;

        if (payloadLen > 0) {
            const nextTagIdx = 9 + 1 + 4 + payloadLen;
            if (nextTagIdx < bytes.length) {
                console.log(`  Expected next tag at ${nextTagIdx}: 0x${bytes[nextTagIdx]?.toString(16)}`);
            }
        }
    }
}

checkLog('p1045');
checkLog('p1034');
checkLog('p21');
