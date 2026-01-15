# Athena Implementation Summary

## File Structure

### `src/lib/athena-parser.ts`

Tag-based packet parser:

- `parsePacket()`: Single packet parsing (tag → payload extraction → bit unpacking → physical unit conversion)
- `packetParser()`: Bulk buffer processing

Supported tags:
- `0x11`/`0x12`: EEG (14-bit, 8ch×2samples, 256Hz, scale: 0.0885µV/LSB)
- `0x47`: ACC_GYRO (16-bit, 3samples, 52Hz, ACC: 0.000061G/LSB, GYRO: 0.0074768dps/LSB)
- `0x34`/`0x35`: OPTICAL (20-bit, 3samples×4ch, 64Hz, scale: 1/32768)
- `0x88`: BATTERY (16-bit, 10values, 1Hz)
- `0x53`: DRL_REF (14-bit, 32Hz)

### `src/muse-athena.ts`

Athena client:

- `connect()`: BLE connection and characteristic discovery
- `start(preset)`: Send preset and start streaming
- Streams: `eegReadings`, `accGyroReadings`, `opticalReadings`, `batteryData`, `rawPackets`
- Timestamp management: Independent continuous time generation per data type (recalibration after 500ms+ gaps)

Command implementation:
- `v4`/`v6`: Version request
- `s`/`h`: Stream start/stop
- `p21`/`p1045`, etc.: Preset selection
- `dc001`: Data transmission start
- `L1`: LED control

## Technical Features

- **LSB-first bit unpacking**: `parseUintLEValues()`/`parseIntLEValues()` extract 14/16/20-bit non-byte-aligned values
- **Physical unit conversion**: EEG→µV, ACC→G, GYRO→dps, Optical→normalized
- **Timestamp consistency**: Maintains fixed intervals based on frequency for each data type
- **Unknown tag resilience**: Continues to next tag on parse failure to maintain stream stability
