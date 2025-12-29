/**
 * Test Athena parser with data_p1045.txt samples
 */

import { parsePacket, packetParser } from '../src/lib/athena-parser';

// Sample packets from data_p1045.txt
const samples = [
    // Line 1: tag 0x47 (ACC/GYRO), 215 bytes
    'd700009c3dd18993014700a601004cc3ebfc23109700fc00930095c0d0fcad0c5dfcd50018fd6fc120fd350eb6ffec01d0fe1200543801ffdffff7fffd7fffdffff7ff0180fc1fffc7fff17f24a008a802667f1201913801056141581016843adfc8a7f1d97dbfdd6ff7dbf176f8a18b882246891202af3801aeac2bdbcadab2c8da5816a3294effffffffffffff2f16b0542de14a1203ec3801bc3fefbffb63fe1166bdf83c92a18ebfe3aff857fe4f6b1b2ab4b2b11204293901ffffffffffffff5ae45c783ff699ffffffffffffff545ae1a588e970',

    // Line 2: tag 0x12 (EEG), 240 bytes
    'f00100ec3dd189930112058c0200ffffffffffffff731ae9f57a196ffffffffffff7ff5e24637828be9512067a0000fffffffffffbff992af329a3d6aeffffffffffffffb0a5b718554e9c1207990000ffffffffffffff479b1fe6977572ffffffffffffff5bd9a0656589681208d60000ffffffffffffff8ae2ed37037a8bffffffffffffff1b2ad6999436a91209130100ffffffffffffff60e6e8885bb29affffffffffffff9c1b3d869afd6f120a500100ffffffffffffff0b5855b54e7560ffffffffffffff71606b97dec980120b8d0100ffffffffffffffffe8935980e2a2fffffffffffffff6e613a966269b',
];

function testPacketParsing() {
    console.log('=== Athena Packet Parser Test ===\n');

    for (const hexStr of samples) {
        const data = new Uint8Array(Buffer.from(hexStr, 'hex'));

        console.log(`\nPacket: ${hexStr.substring(0, 20)}... (${data.length} bytes)`);
        console.log(`  Byte 0 (len): 0x${data[0].toString(16).padStart(2, '0')} = ${data[0]}`);
        console.log(`  Byte 1 (counter): 0x${data[1].toString(16).padStart(2, '0')} = ${data[1]}`);
        console.log(`  Byte 9 (tag): 0x${data[9].toString(16).padStart(2, '0')}`);

        const tagIndex = 9;
        try {
            const [nextIdx, typeName, entries, samples] = parsePacket(data, data[9], tagIndex, true);

            console.log(`  ✓ Parsed: ${typeName}, ${samples} samples, ${entries.length} entries`);
            for (const entry of entries) {
                console.log(
                    `    - ${entry.type}: ${entry.data
                        .slice(0, 3)
                        .map((v) => v.toFixed(2))
                        .join(', ')}...`,
                );
            }
        } catch (e) {
            console.error(`  ✗ Parse error:`, e);
        }
    }

    console.log('\n=== Full packet parser test ===\n');
    for (const hexStr of samples) {
        const data = new Uint8Array(Buffer.from(hexStr, 'hex'));
        const [counts, packets] = packetParser(data, false, true);

        console.log(
            `Packet ${data[9] === 0x12 ? '0x12 (EEG)' : data[9] === 0x47 ? '0x47 (ACC/GYRO)' : `0x${data[9].toString(16)}`}:`,
        );
        console.log(`  Packets: ${JSON.stringify(counts)}`);
        console.log(`  Total entries: ${packets.reduce((sum, p) => sum + p.entries.length, 0)}`);
    }
}

testPacketParsing();
