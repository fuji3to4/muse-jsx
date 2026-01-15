# Migration Guide: Classic vs Athena

## Choosing the Client

### Classic Muse (Muse 2, Original Muse S) → `MuseClient`

```typescript
import { MuseClient } from 'muse-jsx';

const client = new MuseClient();
await client.connect();
await client.start();

client.eegReadings.subscribe(reading => {
    console.log(reading.electrode, reading.samples);
});
```

### Muse S (Athena) → `MuseAthenaClient`

```typescript
import { MuseAthenaClient } from 'muse-jsx';

const client = new MuseAthenaClient();
await client.connect();
await client.start('p1045');

client.eegReadings.subscribe(reading => {
    console.log(reading.electrode, reading.samples);
});
```

## Key Differences

| Feature | `MuseClient` | `MuseAthenaClient` |
|---------|--------------|---------------------|
| Target Device | Muse 2, Classic Muse S | Muse S (Athena) |
| Packet Format | Channel-separated | Tag-based unified |
| Streams | Per electrode | Per type |
| Presets | `p20`, `p21`, `p50` | `p1045`, `p21`, `p1034` |
| Commands | `v1`, `d`, `s` | `v4`, `v6`, `dc001` |

## Athena Streams

```typescript
client.eegReadings          // EEG (256Hz, 8ch)
client.accGyroReadings      // IMU (52Hz)
client.opticalReadings      // PPG (64Hz)
client.batteryData          // Battery (1Hz)
client.rawPackets           // Raw packets (debugging)
```

**Note**: Both clients cannot be used simultaneously on the same connection. Choose the correct class based on your device.
