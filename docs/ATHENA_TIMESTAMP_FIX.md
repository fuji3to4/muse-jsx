# Athena Timestamp Fix

## Problem

EEG timestamps had irregular gaps between packets. While same-index samples had correct 3.9ms intervals (1/256Hz), transitions between indices showed large, irregular gaps of tens of milliseconds.

### Root Cause

1. **BLE notification structure**: Athena sends multiple EEG packets per BLE notification
2. **Date.now() precision**: JavaScript's `Date.now()` has only millisecond precision
3. **Synchronous processing**: Multiple packets within a notification are processed in the same millisecond, resulting in identical timestamps

### Example of the Problem

```
Expected: 7.813ms between packets (2 samples / 256Hz)
Actual:   0.008ms, 1ms, 2ms, 9ms (irregular)
```

## Solution

### Approach: Packet Count-Based Timestamps

Instead of relying on `Date.now()` for each packet (which lacks precision), use a packet counter with fixed delta timing:

```typescript
// Initialize base timestamp on first packet
if (this.eegBaseTimestamp === 0) {
    this.eegBaseTimestamp = Date.now();
}

// Calculate timestamp based on packet count
const packetTimestamp = this.eegBaseTimestamp +
    (this.eegPacketCount * samples * 1000) / freqHz;

this.eegPacketCount++;
```

### Why This Works

1. **Consistent timing**: Fixed delta ensures uniform intervals
2. **Matches hardware sampling**: Based on actual device sampling rate
3. **Compatible with zip-samples.ts**: Uniform timestamps allow proper buffering
4. **Same as Classic Muse**: Proven approach from Muse 2 implementation

## Implementation Details

### State Variables

```typescript
// Packet count-based timestamp tracking
private eegPacketCount = 0;
private eegBaseTimestamp = 0;
private accGyroPacketCount = 0;
private accGyroBaseTimestamp = 0;
private opticalPacketCount = 0;
private opticalBaseTimestamp = 0;
```

### Timestamp Calculation

| Sensor Type | Frequency | Samples/Packet | Interval |
|-------------|-----------|----------------|----------|
| EEG | 256Hz | 2 | 7.8125ms |
| ACC_GYRO | 52Hz | 3 | 19.23ms |
| OPTICAL | 64Hz | 3 | 15.625ms |

### Reset on Disconnect

```typescript
disconnect() {
    this.eegPacketCount = 0;
    this.eegBaseTimestamp = 0;
    this.accGyroPacketCount = 0;
    this.accGyroBaseTimestamp = 0;
    this.opticalPacketCount = 0;
    this.opticalBaseTimestamp = 0;
    // ... disconnect BLE
}
```

## BrainFlow Comparison

### BrainFlow Approach (C++)

- Uses `GetSystemTimePreciseAsFileTime` (microsecond precision)
- Each packet gets independent high-resolution timestamp
- `get_sample_timestamp()` interpolates within each packet

### JavaScript Limitation

- `Date.now()` has only millisecond precision
- Cannot distinguish packets processed within same millisecond
- Solution: Use fixed delta based on sampling rate

## Technical Notes

### Why Not Date.now() for Each Packet?

```javascript
// Problem: Multiple calls in same millisecond return same value
const t1 = Date.now(); // 1785233537954
// ... process packet ...
const t2 = Date.now(); // 1785233537954 (same!)
```

### Why Fixed Delta is Correct

1. Device samples at fixed rate (256Hz for EEG)
2. BLE transmits at predictable intervals
3. Packet count directly correlates with sample count
4. Base timestamp provides absolute time reference

## Testing

After implementation, verify:

1. EEG timestamps show consistent 7.8125ms intervals
2. `zip-samples.ts` correctly groups readings by timestamp
3. Filtered samples have monotonic timestamps
4. No negative gaps in timestamp differences

## References

- BrainFlow Muse Athena implementation: `muse_athena.cpp`
- Classic Muse timestamp handling: `muse.cpp`
- Original issue: Timestamp gaps between indices
