import fs from 'fs';
import path from 'path';

const testDir = 'e:/Data/App/EEG/muse-jsx/test';
const files = fs.readdirSync(testDir).filter((f) => f.startsWith('log_') && f.endsWith('.csv'));

const results: Record<string, Set<string>> = {};

files.forEach((file) => {
    const preset = file.substring(4, file.length - 4); // "p1045", etc.
    const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
    const lines = content.split('\n');
    const ids = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length < 3) continue;

        const hex = parts[2];
        if (hex.length >= 20) {
            const id = hex.substring(18, 20); // 10th byte
            ids.add(id);
        }
    }
    results[preset] = ids;
});

console.log('Summary of Packet IDs by Preset:');
for (const [preset, ids] of Object.entries(results)) {
    const sortedIds = Array.from(ids).sort();
    console.log(`Preset ${preset}: ${sortedIds.join(', ')}`);
}
