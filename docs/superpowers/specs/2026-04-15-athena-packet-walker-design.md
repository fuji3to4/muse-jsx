# Athena packet walker design

## Problem

The Athena path currently mixes two different protocol models:

1. BLE notifications received by `MuseAthenaClient`
2. Athena packet and subpacket decoding in `src\lib\athena-parser.ts`

The current parser logic assumes each parsed unit starts with `[TAG][META4][PAYLOAD]`. That does not match the OpenMuse interpretation documented in `docs\MY_NOTE.md`, where an Athena packet contains:

1. a packet header
2. a first subpacket whose type comes from `pkt_id` and whose payload begins immediately after the packet header
3. zero or more additional subpackets encoded as `[TAG][META4][PAYLOAD]`

Because of that mismatch, one BLE notification containing multiple Athena subpackets is harder to parse correctly and is more fragile around variable-length payloads such as `0x88`.

## Goals

1. Align internal Athena packet walking with the OpenMuse packet structure.
2. Correctly recover multiple subpackets from a single BLE notification in order.
3. Keep the public `MuseAthenaClient` observable API shape compatible.
4. Localize Athena protocol knowledge in the parser layer instead of spreading it across RxJS client code.

## Non-goals

1. Redesign the public Athena observable interfaces.
2. Rework timestamp generation beyond what is required to preserve current client behavior.
3. Add support for currently unknown Athena payload types beyond stable boundary handling.

## Proposed approach

Split the Athena implementation into two internal responsibilities:

1. **Packet walker** in `src\lib\athena-parser.ts`
2. **Client projection layer** in `src\muse-athena.ts`

The packet walker becomes responsible for traversing Athena BLE notification bytes using OpenMuse-compatible packet structure rules. The client layer consumes normalized decoded results and maps them to the existing `eegReadings`, `accGyroReadings`, `opticalReadings`, and `batteryData` observables.

## Architecture

### 1. Packet walker

Add a low-level walker that reads a BLE notification as Athena packet content rather than as a flat stream of independent tagged blocks.

The walker will:

1. read the packet header metadata already present in the notification
2. identify the first subpacket type from `pkt_id`
3. consume the first subpacket payload without expecting a leading tag or extra metadata bytes
4. continue through the remaining bytes as repeated `[TAG][META4][PAYLOAD]` subpackets
5. stop when the remaining bytes are not sufficient to describe the next complete subpacket

The walker should return normalized internal records that include:

- source packet metadata needed by the client
- subpacket type
- optional subpacket metadata for later use
- sample count and nominal frequency
- decoded numeric values

### 2. Payload decoder

`parsePacket()` should stop acting like a packet walker. Instead, the decoding side should accept already-isolated subpacket payloads together with the effective tag and metadata describing whether the subpacket is the first packet payload or a later tagged payload.

This keeps decode rules focused on sensor semantics:

- EEG / DRL-REF: packed 14-bit values with centered microvolt scaling
- ACC/GYRO: fixed 36-byte payload with current scaling
- OPTICAL: fixed-width packed payloads for 4/8/16 channel variants
- BATTERY: first two bytes as state-of-charge, while preserving full-boundary consumption for variable-length `0x88`

### 3. Client projection

`MuseAthenaClient` should no longer need to understand Athena subpacket boundaries. It should:

1. hand raw notification bytes to the walker
2. receive normalized decoded subpackets in original order
3. filter/project each decoded item into the existing observable outputs
4. keep timestamp assignment where it already belongs today: close to the observable emission layer

This preserves public API compatibility while reducing protocol logic in the client.

## Data flow

The intended runtime flow is:

1. `observableCharacteristic()` emits one Athena BLE notification.
2. `MuseAthenaClient` passes the notification buffer to the packet walker.
3. The walker emits decoded subpacket records in wire order.
4. `MuseAthenaClient` maps each decoded record into existing output shapes:
   - EEG -> one reading per electrode with channel samples
   - ACC/GYRO -> one reading per sample group
   - OPTICAL -> one reading per optical sample group
   - BATTERY -> one reading containing the decoded battery values
5. Existing timestamp helpers continue to stamp emitted readings.

This design explicitly supports notifications containing mixed content, such as EEG followed by IMU or battery status in the same notification.

## Error handling

Error handling is intentionally partial, not all-or-nothing.

If the walker can successfully decode one or more subpackets and later encounters an incomplete or invalid trailing subpacket, it should:

1. keep the decoded subpackets that were already recovered
2. stop processing the remainder of that notification
3. avoid emitting fabricated fallback values

This matches the approved behavior of "read what is still structurally valid, then stop at the damaged tail". It limits data loss when only the final bytes of a notification are malformed or truncated.

Unknown tags should remain non-fatal. They should stop parsing only when the parser cannot determine a safe boundary for the next unit.

## Testing strategy

Add or adapt tests around the parser and client flow to cover the following cases:

1. **Multiple subpackets in one notification**  
   A notification containing a first subpacket plus at least one later tagged subpacket should yield both decoded outputs in order.

2. **First-subpacket rule**  
   A packet whose first subpacket is derived from `pkt_id` should decode correctly even though no leading `[TAG][META4]` bytes exist for that first payload body.

3. **Mixed payload notification**  
   A notification containing EEG first and IMU or optical later should produce both observable outputs without boundary confusion.

4. **Variable-length battery payload**  
   `0x88` should decode battery percentage from the first two payload bytes while consuming only the bytes belonging to that subpacket according to the walker’s boundary logic.

5. **Damaged trailing subpacket**  
   A notification with a valid first subpacket and a truncated trailing subpacket should still emit the valid decoded result and stop at the damaged tail.

## Migration notes

The implementation should prefer introducing the walker alongside the current decoder utilities, then moving `MuseAthenaClient` to the new normalized output path. Once the client no longer depends on the old walking assumptions, obsolete traversal logic can be removed from the parser.

## Risks and mitigations

### Risk: duplicated parsing logic during transition

Mitigation: keep a single low-level source of truth for subpacket boundary walking and make the client consume only normalized parser output.

### Risk: hidden dependence on current parser return shape

Mitigation: preserve the existing public observable output types and confine internal shape changes to parser/client internals.

### Risk: regressions around `0x88`

Mitigation: add explicit tests for variable-length battery packets and mixed notifications containing battery data.

## Success criteria

The change is successful when:

1. one BLE notification containing multiple Athena subpackets is decoded in order
2. first and later subpackets follow different structural rules without confusing boundaries
3. `MuseAthenaClient` keeps its current public observable contracts
4. malformed trailing bytes do not discard earlier valid decoded subpackets from the same notification
