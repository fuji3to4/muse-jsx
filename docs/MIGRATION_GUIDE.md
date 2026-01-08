# Muse TypeScript Client - Classic vs. Athena Migration Guide

## File Structure

The library is split to handle the differences between the Classic (2016) and Athena (Series 2/S) architectures cleanly.

```
src/
├── muse.ts           # Classic Muse Client (Unchanged)
├── muse-athena.ts    # Athena Client (New)
└── lib/
    ├── athena-parser.ts        # Athena Packet Parsing logic
    ├── muse-interfaces.ts      # Shared Interfaces
    └── ...
```

## Choosing the Client
 
 ### Classic Muse (Muse 2, Original Muse S) → `MuseClient`
 Use this for the older model Muse headsets, including Muse 2016 (Muse 2) and the original Muse S.
 
 ```typescript
 import { MuseClient } from './muse';
 
 const client = new MuseClient();
 await client.connect();
 await client.start();
 
 client.eegReadings.subscribe(reading => {
     // 'reading' structure typically contains index, electrode ID, samples
     console.log('EEG:', reading.samples);
 });
 ```
 
 ### Muse S (Athena Model) → `MuseAthenaClient`
 Use this for newer Muse S devices running the Athena protocol.
 
 ```typescript
 import { MuseAthenaClient } from './muse-athena';
 
 const client = new MuseAthenaClient();
 await client.connect();
 
 // You can specify a preset here
 await client.start('p1045');
 
 client.athenaEegReadings.subscribe(reading => {
     // 'reading' implies a batch of samples derived from a single packet
     console.log('EEG:', reading.samples);
 });
 ```
 
 ## Main Differences
 
 | Feature | `MuseClient` | `MuseAthenaClient` |
 |---------|-------------|-------------------|
 | **Target Device** | Muse 2 (2016), Original Muse S | Muse S (Athena Model) |
 | **Packet Format** | Channel-separated characteristics | Tag-based multiplexed packets |
 | **EEG Access** | Individual/AUX characteristics | Unified sensor characteristic |
 | **Streaming** | Stream per electrode | Single stream parsed into types |
 | **Presets** | `p20`, `p21`, `p50` | `p21`, `p1045` (Recommended) |

## Athena Streams & Data

`MuseAthenaClient` provides 4 main Observables based on the tag encountered:

```typescript
// EEG (Tag 0x12, 256Hz)
client.athenaEegReadings.subscribe(reading => {
    console.log(reading.samples); // Array of 16 values (8ch * 2 samples)
});

// IMU (Tag 0x47, 52Hz)
client.athenaAccGyroReadings.subscribe(reading => {
    console.log(reading.acc);   // 3 samples (x,y,z)
    console.log(reading.gyro);  // 3 samples (x,y,z)
});

// Optical / PPG (Tag 0x34, 64Hz)
client.athenaOpticalReadings.subscribe(reading => {
    console.log(reading.samples); // 12 values
});

// Battery (Tag 0x98, 0.1Hz)
client.athenaBatteryData.subscribe(data => {
    console.log(data.values); // 10 values
});
```

## Command Handling

### MuseClient
```typescript
await client.sendCommand('v1');  // Request Version
await client.sendCommand('d');   // Start Streaming
await client.start();            // Auto-initialization
```

### MuseAthenaClient
Athena devices rely more heavily on presets for configuration.

```typescript
await client.sendCommand('v4');     // Request Version
// Presets determine what data is sent (EEG, IMU, PPG, etc.)
await client.start('p1045'); 
```

## Packet Logger Customization

The Athena client exposes the raw BLE stream for debugging or custom parsing:

```typescript
client.rawPackets.subscribe(packet => {
    // Access raw Uint8Array data
    console.log(packet.data); 
});
```

---

**Important**: You cannot effectively use both clients simultaneously on the same connection object. You must instantiate the correct class (`MuseClient` or `MuseAthenaClient`) based on the device the user selects.
