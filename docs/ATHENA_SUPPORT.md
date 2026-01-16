# Athena Support

Support for Muse S (Athena) devices. Athena uses a new Bluetooth protocol with tag-based packet format to transmit unified multi-sensor data.

> **Note:** Classic Muse S models use `MuseClient`. `MuseAthenaClient` is for the newer Athena protocol only.

## Basic Usage

```typescript
import { MuseAthenaClient } from 'muse-jsx';

const client = new MuseAthenaClient();
await client.connect();
await client.start('p1045'); // Default preset

// EEG (8ch, 256Hz)
client.eegReadings.subscribe(reading => {
    console.log(reading.electrode, reading.samples);
});

// IMU (52Hz)
client.accGyroReadings.subscribe(reading => {
    console.log(reading.acc, reading.gyro);
});

// Optical (64Hz)
client.opticalReadings.subscribe(reading => {
    console.log(reading.samples);
});

// Battery (1Hz)
client.batteryData.subscribe(data => {
    console.log(data.values);
});
```

## Presets

- `p1045`: Standard (EEG 8ch + IMU + Optical) - Recommended
- `p1034`, `p1035`: Alternative configurations
- `p21`: Basic configuration

## P1045 Packet Format

| Tag | Type | Samples/Packet | Freq | Bits |
|-----|------|----------------|------|------|
| 0x12 | EEG | 2 | 256Hz | 14-bit |
| 0x47 | ACC_GYRO | 3 | 52Hz | 16-bit |
| 0x34 | OPTICAL | 3 | 64Hz | 20-bit |
| 0x88 | BATTERY | 1 | 1Hz | 16-bit |

## Debugging

Access raw packets:

```typescript
client.rawPackets.subscribe(packet => {
    console.log(packet.uuid, packet.data);
});
```

## Troubleshooting

- **Connection fails**: Ensure no other app (e.g., official Muse app) is connected
- **No data received**: Verify `start()` was called. Try different presets
- **Unknown tags**: Check `rawPackets` stream
