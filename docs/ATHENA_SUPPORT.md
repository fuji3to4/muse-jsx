# Athena Support for Muse-JSX

This document describes the support for **Muse S (Athena)** devices within `muse-jsx`.

## Overview

This library extension targets the newer **Muse S (Athena)** devices which use a different Bluetooth protocol compared to the classic Muse 2 and original Muse S.

> **Important:** The original Muse S models use the classic protocol and should be used with the standard `MuseClient`. `MuseAthenaClient` is only for the newer revisions (Athena).

The updated `muse-jsx` library provides:
- **Athena Packet Parsing**: Supports Tags `0x12` (EEG), `0x47` (IMU), `0x34` (Optical), and `0x88`/`0x98` (Battery).
- **Preset Management**: Ability to initialize the device with specific command presets.
- **Packet Logging**: Tools to inspect raw Bluetooth packets for debugging.
- **Backward Compatibility**: `MuseClient` remains for older devices, while `MuseAthenaClient` handles the new protocol.

## Architecture

### File Structure

```
src/
├── muse.ts                 # Classic MuseClient (Legacy support)
├── muse-athena.ts          # MuseAthenaClient (New implementation)
└── lib/
    ├── athena-parser.ts    # Packet parsing logic & bitwise operations
    ├── muse-interfaces.ts  # Shared and specific TypeScript interfaces
    └── ...
```

### Packet Format

Packets begin with a **Tag Byte**, followed by a 4-byte index/timestamp (often ignored in parsing logic in favor of position), and then the payload.

| Tag | Type | Samples | Freq | Description |
|-----|-----|---------|------|------|
| 0x12 | EEG | 2 | 256 Hz | 8 channels, 14-bit precision |
| 0x47 | ACC_GYRO | 3 | 52 Hz | Accelerometer + Gyroscope |
| 0x34 | OPTICAL | 3 | 64 Hz | Optical/PPG Sensors (Front/Head) |
| 0x88/98 | BATTERY | 1 | 0.1 Hz | 10-value battery metrics |

## Usage

### Connecting to Athena

Use the `MuseAthenaClient` class. You can specify a preset during the `start()` call.

```typescript
import { MuseAthenaClient } from './muse-athena';

const client = new MuseAthenaClient();

await client.connect();

// Start streaming with a specific preset.
// 'p1045' is commonly used for standard 8-channel EEG + IMU.
await client.start('p1045');
```

### Subscribing to Data

The client exposes RxJS Observables for each data type:

```typescript
// EEG
client.athenaEegReadings.subscribe((reading) => {
    // reading.samples contains 16 values (8 channels * 2 samples)
    console.log('EEG:', reading.samples);
});

// IMU (Accelerometer & Gyroscope)
client.athenaAccGyroReadings.subscribe((reading) => {
    console.log('Accel:', reading.acc); // Array of {x,y,z}
    console.log('Gyro:', reading.gyro);
});

// Optical / PPG
client.athenaOpticalReadings.subscribe((reading) => {
    console.log('PPG:', reading.samples);
});
```

### Packet Logger

For research and debugging, you can access the raw incoming packets before they are parsed into readings. This is useful for verifying protocol details or recording sessions.

```typescript
client.rawPackets.subscribe((packet) => {
    // packet.data is a Uint8Array of the raw BLE characteristic value
    console.log(`Received packet from ${packet.uuid}`, packet.data);
});
```

The Demo App includes a UI to capturing these packets and exporting them as CSV.

## Presets

Athena devices require "Presets" to define which sensors are active and their transmission rates. Common presets include:

| Preset | Description |
|--------|-------------|
| `p1045` | Standard EEG + IMU + Optical (Recommended) |
| `p21` | Basic configuration |
| `p50` | Alternative configuration |

You can switch presets by passing the string to the `start()` method:
```typescript
await client.start('p50');
```

## Interfaces

### AthenaEEGReading
```typescript
interface AthenaEEGReading {
    timestamp: number;      // Host timestamp (ms)
    samples: number[];      // Array of 16 physiological values
}
```

### AthenaAccGyroReading
```typescript
interface AthenaAccGyroReading {
    timestamp: number;
    acc: XYZ[];            // 3 samples of Accelerometer data
    gyro: XYZ[];           // 3 samples of Gyroscope data
}
```

## Parsing Logic Details

1. **Tag Detection**: Identifies the packet type from the first byte.
2. **Payload Extraction**: Skips header bytes and isolates the data block.
3. **Bit Unpacking**:
    - **EEG**: Parses 16 blocks of 14-bit values per packet. Scaled by `0.x` factor (voltage conversion).
    - **Optical**: Parses 20-bit values.
    - **IMU**: Parses 16-bit signed integers, scaled to `g` or `deg/s`.

## Troubleshooting

### Device connection fails or hangs
- Ensure no other application (like the official Muse app) is connected.
- Web Bluetooth implementations typically require a secure context (HTTPS) and a user gesture (click) to trigger the connection dialog.

### No data appearing
- Check if you called `client.start()`.
- Try a different preset (e.g., `p21` instead of `p1045`).
- Ensure the headset is being worn correctly (signal quality affects transmission in some modes).

### Packet parsing errors
- If you see warnings about buffer overflows or unknown tags, the device might be sending a packet type not yet fully documented. Use the `rawPackets` stream to inspect the unknown tags.

## License

This project is part of `muse-jsx`. See the main LICENSE file for details.
