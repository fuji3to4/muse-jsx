# Align Muse Athena extraction with BrainFlow design

## Problem

`src/muse-athena.ts` and `src/lib/athena-parser.ts` implement their own reading of the
Muse Athena BLE tag-based packet protocol. BrainFlow's C++ implementation
(`board_controller/muse/muse_athena.cpp`) is the most widely used reference implementation
of this same protocol. Comparing the two surfaced several places where the TypeScript
implementation diverges from BrainFlow in ways that look unintentional rather than
deliberate design choices:

- Timestamps drift forever after the first packet of a session instead of tracking
  real arrival time.
- A single BLE notification is assumed to contain exactly one physical Athena packet.
  BrainFlow's implementation explicitly supports multiple physical packets concatenated
  in one notification.
- An unrecognized tag causes the parser to slide forward one byte at a time hoping to
  resynchronize, instead of abandoning the corrupted region the way BrainFlow does.
- The packet sequence number is truncated to 8 bits instead of BrainFlow's 16 bits.
- EEG, OPTICAL, and BATTERY scale factors differ from BrainFlow's constants (in the EEG
  case, by design — an explicit comment says it was aligned with a different reference,
  OpenMuse — but the user has asked to standardize on BrainFlow throughout this pass).

This design brings extraction behavior in `muse-athena.ts` / `athena-parser.ts` in line
with BrainFlow's implementation, treating BrainFlow as the reference implementation for
every point of divergence identified below.

## Scope

In scope:

- Packet/notification framing (multi-packet splitting, hard-stop-on-unknown-tag,
  16-bit packet index, composite package number)
- Timestamp calculation for EEG / ACC_GYRO / OPTICAL readings
- EEG, OPTICAL, and BATTERY scale factors, and BATTERY payload length
- Extracting all scale/framing constants into a single, easily-editable constants file
- Minor cleanup of the OPTICAL channel-name index table and the unused
  `opticalChannel` field

Out of scope:

- Restructuring the shape of emitted reading objects (e.g. `EEGReading`,
  `AthenaOpticalReading`) beyond removing the dead `opticalChannel` field — the demo app
  (`demo/src/graph-model.ts`) already depends on the current per-packet /
  per-channel-array shape and that shape is not what's broken.
- Any change to the ACC/GYRO scale factors or channel ordering — these were checked
  against BrainFlow and already match (aside from floating-point precision, which is not
  worth changing).
- Muse Classic (non-Athena) parsing paths.

## Constants file

New file: `src/lib/athena-constants.ts`. Mirrors BrainFlow's
`muse_athena_constants.h` / `muse_athena.h` constants so they're easy to find and revise
independently of parsing logic:

```ts
// Scale factors — mirrors brainflow's muse_athena_constants.h
export const MUSE_ATHENA_EEG_SCALE_FACTOR = 0.40293040293040294;
export const MUSE_ATHENA_ACC_SCALE_FACTOR = 0.00006103515625;
export const MUSE_ATHENA_GYRO_SCALE_FACTOR = -0.007476806640625;
export const MUSE_ATHENA_OPTICS_SCALE_FACTOR = 1.0;
export const MUSE_ATHENA_BATTERY_SCALE_FACTOR = 1 / 512;

// Packet framing — mirrors brainflow's muse_athena.h
export const PACKET_HEADER_SIZE = 14;
export const SUBPACKET_HEADER_SIZE = 5;
```

`athena-parser.ts` and `muse-athena.ts` import from this file instead of declaring local
`EEG_SCALE` / `ACC_SCALE` / `GYRO_SCALE` / `OPTICS_SCALE` constants, which are removed.

## Packet / notification framing

BrainFlow's `handle_data_notification` treats one BLE notification's payload as a
sequence of concatenated physical packets, each self-describing its own length. The
current TypeScript code assumes one notification == one physical packet and walks tags
from a fixed offset to the end of the buffer — with no outer length-based framing at
all, and no recovery strategy that matches BrainFlow's when data doesn't parse cleanly.

`athena-parser.ts` gets a new exported function:

```ts
export interface AthenaParsedBlock {
    packageNum: number; // (packetIndex << 8) | blockIndex, matches BrainFlow's package_num
    tag: number;
    type: string;
    entries: AthenaEntry[];
    samples: number;
    freqHz: number;
}

export function parseAthenaNotification(data: Uint8Array): AthenaParsedBlock[]
```

Behavior, ported from `handle_data_notification` / `parse_sensor_payload`:

1. Outer loop over physical packets: `packetLen = data[offset]`. If fewer than
   `PACKET_HEADER_SIZE` bytes remain, or `packetLen < PACKET_HEADER_SIZE`, or
   `offset + packetLen > data.length`, stop processing this notification entirely
   (matches BrainFlow's short-tail / invalid-length warn-and-return).
2. `packetIndex` is the 16-bit little-endian value at `data[offset+1..offset+2]` (fixes
   the current 8-bit truncation at `packet[1]` only).
3. `primaryTag = data[offset+9]`, `primaryBlockIndex = data[offset+10]`. Primary payload
   starts at `offset + PACKET_HEADER_SIZE`.
4. If the primary tag is unrecognized, or its fixed payload length doesn't fit in the
   remaining physical-packet bytes, abandon the rest of this physical packet (no
   subpacket scanning is attempted) — matches BrainFlow's `packet_data_offset =
   packet_data_size` fallback. Otherwise parse it and set
   `packageNum = (packetIndex << 8) | primaryBlockIndex`.
5. Subpacket loop: while at least `SUBPACKET_HEADER_SIZE` bytes remain in this physical
   packet, read `tag` and `subpacketIndex` from the next 2 bytes. If the tag is
   unrecognized, or its fixed payload length doesn't fit in the remaining bytes, **stop
   the subpacket loop immediately** (matches BrainFlow's `break` — this replaces the
   current "skip one byte and keep trying" recovery, which can pick up spurious matches
   inside payload bytes once framing has slipped). Otherwise parse it with
   `packageNum = (packetIndex << 8) | subpacketIndex` and advance by
   `SUBPACKET_HEADER_SIZE + dataLen`.
6. Advance the outer loop by `packetLen` regardless of whether the physical packet's
   contents parsed cleanly (framing recovery for the *next* physical packet does not
   depend on how the current one parsed).

The existing per-tag bit-extraction switch in `parsePacket()` (14/16/20-bit field
reads for each tag) is preserved and reused — it's refactored to take an explicit
payload start offset instead of deriving one internally from a tag index, so the new
outer function can call it once per resolved primary/subpacket location.

`muse-athena.ts`'s `parseAthenaPacketForType` and `parseAthenaBatterySync` are rewritten
to call `parseAthenaNotification` once and filter/dispatch on `block.type`, rather than
re-implementing tag walking themselves. `index` on emitted readings becomes
`block.packageNum` (composite 16-bit value) instead of the current single shared,
truncated `packet[1]`.

## Timestamp calculation

Per-sensor-type state changes from a packet-count-based fixed clock to a
last-real-arrival-time model, ported from BrainFlow's `get_sample_timestamp`:

```ts
private lastEegTimestamp: number | null = null;
private lastAccGyroTimestamp: number | null = null;
private lastOpticalTimestamp: number | null = null;
```

`null` is the "uninitialized" sentinel (BrainFlow uses `-1.0`). Reset to `null` in
`connect()`-adjacent `disconnect()` (already resets today), and additionally in
`start()`, `resume()`, `pause()`, and `stop()`, so a real stream restart never
extrapolates from a stale pre-pause timestamp — matching BrainFlow calling
`reset_timestamps()` in both `start_stream()` and `stop_stream()`.

New private method, evaluated for the first sample of a packet (index 0). The rest of
a packet's samples are already interpolated forward from this base by
`zipSamples` (`timestamp + index * 1000 / EEG_FREQUENCY`), which reproduces BrainFlow's
per-sample formula exactly for the cold-start and normal-interpolation branches once the
base itself is correct:

```ts
private getPacketBaseTimestamp(
    lastTimestamp: number | null,
    currentTimestamp: number,
    nSamples: number,
    rateHz: number,
): number {
    if (lastTimestamp === null) {
        return currentTimestamp - ((nSamples - 1) * 1000) / rateHz;
    }
    if (currentTimestamp <= lastTimestamp) {
        return currentTimestamp;
    }
    const predicted = lastTimestamp + 1000 / rateHz;
    if (predicted <= currentTimestamp) {
        return predicted;
    }
    const step = (currentTimestamp - lastTimestamp) / nSamples;
    return lastTimestamp + step;
}
```

After computing the base, unconditionally set `this.last<Type>Timestamp =
currentTimestamp` (the real arrival time, not the computed/extrapolated value) —
mirroring BrainFlow's `last_eeg_timestamp = host_timestamp;`.

`currentTimestamp` is captured once per physical BLE notification (`Date.now()`), where
`rawSensorPackets$` is built, so EEG/ACC_GYRO/OPTICAL blocks extracted from the same
notification share one arrival time — matching BrainFlow's single `get_timestamp()`
call in `handle_data_notification`:

```ts
const rawSensorPackets$ = sensorObservable.pipe(
    map((p) => ({ data: p.data, arrivalTimestamp: Date.now() })),
    share(),
);
```

Battery parsing keeps using `Date.now()` directly per packet, unaffected — BrainFlow
doesn't apply this algorithm to battery either (it just caches the raw percentage into
`last_battery`, embedded into OPTICS rows).

## Scale factor corrections

All three read from `athena-constants.ts` (Constants file section above):

- **EEG**: `raw * MUSE_ATHENA_EEG_SCALE_FACTOR`, with the `(raw - 8192)` offset
  subtraction removed. The current code's comment says it was deliberately aligned with
  a different reference (OpenMuse); this change intentionally supersedes that in favor
  of BrainFlow.
- **OPTICAL**: `raw * MUSE_ATHENA_OPTICS_SCALE_FACTOR` (`1.0`, i.e. no scaling),
  replacing the current `/ 32768`.
- **BATTERY**: `raw * MUSE_ATHENA_BATTERY_SCALE_FACTOR` (`1/512`), replacing the current
  `/ 256`. Payload length becomes a fixed 20 bytes for both tag `0x88` and `0x98`
  (matching BrainFlow's `SensorConfig` for both), replacing the current behavior of
  reading tag `0x88`'s payload out to the end of the buffer. This also fixes a framing
  hazard: if `0x88` appears as a subpacket before other sensor data in the same physical
  packet, the old "read to end of buffer" behavior would swallow that trailing data.

## Minor cleanup

- `OPTICS_INDEXES[4]` in `athena-parser.ts` currently maps the 4-channel OPTICAL tag to
  channel-name indices `[4, 5, 6, 7]`. BrainFlow's `get_optics_canonical_index` maps
  every tag's channels to canonical indices starting at 0 regardless of channel count.
  Change `OPTICS_INDEXES[4]` to `[0, 1, 2, 3]` to match.
- Remove `opticalChannel` from `AthenaOpticalReading` and stop setting it in
  `muse-athena.ts`. It currently holds the in-packet time-sample index (mislabeled as a
  channel), nothing in this repo or the demo app reads it, and its doc comment
  (`// Channel 0-2 (ambient, IR, red)`) doesn't match what it actually contains.

## Testing

- Unit tests for `parseAthenaNotification` in `athena-parser.spec.ts`: single packet,
  two packets concatenated in one notification, invalid `packetLen`, unrecognized
  primary tag, unrecognized subpacket tag, 16-bit `packetIndex` correctness across the
  256 boundary.
- Unit tests for `getPacketBaseTimestamp` covering all four branches (cold start,
  stale/duplicate clock, normal forward interpolation, faster-than-nominal arrival).
- Update `muse-athena.spec.ts` expected values for the new scale factors and the new
  `index` (packageNum) semantics.
- Full existing test suite must continue passing (`athena-parser.spec.ts`,
  `muse-athena.spec.ts`, `zip-samples.spec.ts`).

## Out of scope (explicit non-goals)

- Consolidating the three `mergeMap` subscriptions in `muse-athena.ts` that each
  independently call the parser per sensor type — this is redundant work but harmless,
  and de-duplicating it is a separate performance concern, not a correctness fix.
- Any change to `AccelerometerData` / `PPGReading` / Muse Classic parsing.
- Validating scale factors against real hardware captures — this design adopts
  BrainFlow's constants as specified, without independent hardware verification.
