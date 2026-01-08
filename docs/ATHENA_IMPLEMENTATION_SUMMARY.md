# Muse Athena Implementation Summary

## File Changes & Additions

### 1. `src/lib/athena-parser.ts` (New)
- **Athena Protocol Parsing Engine**:
    - Supports 5 main packet types:
        - `0x12`: EEG (8ch, 2 samples, 256Hz)
        - `0x47`: ACC_GYRO (3 samples, 52Hz)
        - `0x34`: OPTICAL (3 samples, 64Hz)
        - `0x88` / `0x98`: BATTERY (10 values, 0.1Hz)
    - **Bit Manipulation**: Extracts 14-bit (EEG) and 20-bit (Optical) values using LSB-first logic.
    - `parsePacket()`: Low-level single packet parsing.
    - `packetParser()`: High-level bulk buffer processing.

### 2. `src/lib/muse-interfaces.ts` (Modified)
New interfaces added for Athena data structures:
- `AthenaEEGReading`: EEG data frames.
- `AthenaAccGyroReading`: Combined Accelerometer and Gyroscope data.
- `AthenaOpticalReading`: PPG/Optical sensor data.
- `AthenaBatteryData`: Battery status information.
- `AthenaPacket`: Raw packet structure for logging.

### 3. `src/muse-athena.ts` (New / Refactored)
Dedicated client class `MuseAthenaClient` for Athena devices:
- **Preset Selection**: Supports initialization with specific presets (e.g., `p1045`, `p21`).
- **Unified Streams**:
    - `athenaEegReadings`
    - `athenaAccGyroReadings`
    - `athenaOpticalReadings`
    - `athenaBatteryData`
    - `rawPackets`: A stream of raw data packets for logging and debugging.
- **Command Implementation**: Handles Athena-specific control commands (`d`, `h`, `s`, `v4`, etc.).

## Key Features

### ✅ Full Athena Protocol Support
- Compatible with Python reference implementations (`athena_packet_decoder.py`).
- Handles tag-based packet formats.
- Complete implementation of complex bitwise parsing logic.

### ✅ RxJS Stream Integration
- Maintains the same reactive API philosophy as the classic `MuseClient`.
- Provides `Observable<T>` for all sensor types.
- Easy integration with standard RxJS operators (`filter`, `map`, `tap`).

### ✅ Packet Logger & Debugging
- **Raw Packet Access**: Exposed via `client.rawPackets` stream.
- **CSV Logging**: Data can be captured, viewed in hex format, and exported to CSV (as demonstrated in the Demo App).
- Useful for reverse engineering and verifying protocol details.

### ✅ Dynamic Preset Configuration
- Users can select startup presets to configure the device for different data modes.
- Example: `p1045` (default), `p21` (auxiliary enabled), etc.

## Usage Example

```typescript
import { MuseAthenaClient } from './muse-athena';

const client = new MuseAthenaClient();

await client.connect();
// Start with a specific preset (e.g., p1045 for standard partial mode)
await client.start('p1045');

// EEG Stream
client.athenaEegReadings.subscribe(reading => {
    console.log(`EEG Timestamp: ${reading.timestamp}`);
    console.log(`Samples: ${reading.samples.join(',')}`);
});

// IMU Stream
client.athenaAccGyroReadings.subscribe(reading => {
    console.log(`ACC: ${JSON.stringify(reading.acc)}`);
    console.log(`GYRO: ${JSON.stringify(reading.gyro)}`);
});

// Raw Packet Logging (for debugging)
client.rawPackets.subscribe(packet => {
    console.log(`Packet [${packet.uuid}]: ${packet.data}`);
});
```

## Technical Highlights

- **Bitwise Precision**: Accurate extraction of non-byte-aligned values (14-bit, 20-bit).
- **Physical Scaling**: Automatic conversion of raw values to physical units (mV, m/s², deg/s).
- **Resilience**: Skips unknown tags to maintain stream stability.
- **Buffer Management**: Handles Bluetooth LE fragmentation efficiently.

---

With this update, `muse-jsx` provides full-featured support for Muse Athena (Gen 3 / S) headsets, bridging the gap between legacy and modern Muse devices.
