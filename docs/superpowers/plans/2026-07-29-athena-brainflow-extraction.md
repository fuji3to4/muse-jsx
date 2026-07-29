# Athena BrainFlow-Aligned Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `muse-athena.ts` / `athena-parser.ts` packet extraction (framing, sequence numbers, timestamps, and EEG/OPTICAL/BATTERY scale factors) with BrainFlow's `muse_athena.cpp` reference implementation.

**Architecture:** BrainFlow's per-tag bit-extraction math is reused unchanged in `parsePacket()`. A new `parseAthenaNotification()` wraps it with BrainFlow's multi-packet framing (outer `packetLen` loop, 16-bit `packetIndex`, hard-stop-on-unknown-tag). `muse-athena.ts` switches from a fixed-rate packet-count clock to a last-real-arrival-time model (`getPacketBaseTimestamp`, ported from BrainFlow's `get_sample_timestamp`), captured once per physical packet.

**Tech Stack:** TypeScript, RxJS, Jest (`ts-jest`, `jsdom`), `web-bluetooth-mock`.

## Global Constraints

- All scale/framing constants must exactly match BrainFlow's `muse_athena_constants.h` / `muse_athena.h` values verbatim: `MUSE_ATHENA_EEG_SCALE_FACTOR = 0.40293040293040294`, `MUSE_ATHENA_ACC_SCALE_FACTOR = 0.00006103515625`, `MUSE_ATHENA_GYRO_SCALE_FACTOR = -0.007476806640625`, `MUSE_ATHENA_OPTICS_SCALE_FACTOR = 1.0`, `MUSE_ATHENA_BATTERY_SCALE_FACTOR = 1/512`, `PACKET_HEADER_SIZE = 14`, `SUBPACKET_HEADER_SIZE = 5`.
- Do not change ACC/GYRO scale factor values or channel ordering — already verified to match BrainFlow.
- Do not restructure `EEGReading` / `AthenaAccGyroSample` / `AthenaOpticalReading` object shapes beyond removing the dead `opticalChannel` field from `AthenaOpticalReading`.
- Do not consolidate the three `mergeMap` subscriptions in `muse-athena.ts` (`eegReadings`/`accGyroReadings`/`opticalReadings` each independently re-parsing the notification) — explicitly out of scope per the design.
- The full existing test suite (`npm run test`, which runs `eslint` then all `**/*.spec.ts` files repo-wide) must keep passing after every task.

---

### Task 1: Add the `athena-constants.ts` constants file

**Files:**
- Create: `src/lib/athena-constants.ts`
- Test: `src/lib/athena-constants.spec.ts`

**Interfaces:**
- Produces: `MUSE_ATHENA_EEG_SCALE_FACTOR`, `MUSE_ATHENA_ACC_SCALE_FACTOR`, `MUSE_ATHENA_GYRO_SCALE_FACTOR`, `MUSE_ATHENA_OPTICS_SCALE_FACTOR`, `MUSE_ATHENA_BATTERY_SCALE_FACTOR` (all `number`), `PACKET_HEADER_SIZE`, `SUBPACKET_HEADER_SIZE` (both `number`) — all named exports from `src/lib/athena-constants.ts`. Every later task imports from this file.

- [ ] **Step 1: Write the failing test**

Create `src/lib/athena-constants.spec.ts`:

```ts
import {
    MUSE_ATHENA_EEG_SCALE_FACTOR,
    MUSE_ATHENA_ACC_SCALE_FACTOR,
    MUSE_ATHENA_GYRO_SCALE_FACTOR,
    MUSE_ATHENA_OPTICS_SCALE_FACTOR,
    MUSE_ATHENA_BATTERY_SCALE_FACTOR,
    PACKET_HEADER_SIZE,
    SUBPACKET_HEADER_SIZE,
} from './athena-constants';

describe('athena-constants', () => {
    it('matches BrainFlow\'s muse_athena_constants.h scale factors', () => {
        expect(MUSE_ATHENA_EEG_SCALE_FACTOR).toBe(0.40293040293040294);
        expect(MUSE_ATHENA_ACC_SCALE_FACTOR).toBe(0.00006103515625);
        expect(MUSE_ATHENA_GYRO_SCALE_FACTOR).toBe(-0.007476806640625);
        expect(MUSE_ATHENA_OPTICS_SCALE_FACTOR).toBe(1.0);
        expect(MUSE_ATHENA_BATTERY_SCALE_FACTOR).toBe(1 / 512);
    });

    it('matches BrainFlow\'s muse_athena.h packet framing sizes', () => {
        expect(PACKET_HEADER_SIZE).toBe(14);
        expect(SUBPACKET_HEADER_SIZE).toBe(5);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/athena-constants.spec.ts`
Expected: FAIL — `Cannot find module './athena-constants'`

- [ ] **Step 3: Create the constants file**

Create `src/lib/athena-constants.ts`:

```ts
/**
 * Scale factors and packet framing sizes for the Muse Athena BLE protocol.
 * Mirrors BrainFlow's board_controller/muse/inc/muse_athena_constants.h and
 * muse_athena.h so they can be revised independently of parsing logic.
 */

export const MUSE_ATHENA_EEG_SCALE_FACTOR = 0.40293040293040294;
export const MUSE_ATHENA_ACC_SCALE_FACTOR = 0.00006103515625;
export const MUSE_ATHENA_GYRO_SCALE_FACTOR = -0.007476806640625;
export const MUSE_ATHENA_OPTICS_SCALE_FACTOR = 1.0;
export const MUSE_ATHENA_BATTERY_SCALE_FACTOR = 1 / 512;

export const PACKET_HEADER_SIZE = 14;
export const SUBPACKET_HEADER_SIZE = 5;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/athena-constants.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/athena-constants.ts src/lib/athena-constants.spec.ts
git commit -m "feat: add athena-constants.ts mirroring BrainFlow's scale/framing constants"
```

---

### Task 2: Fix EEG/OPTICAL/BATTERY scale factors and battery payload length in `parsePacket`

**Files:**
- Modify: `src/lib/athena-parser.ts`
- Modify: `src/lib/athena-parser.spec.ts`

**Interfaces:**
- Consumes: `MUSE_ATHENA_EEG_SCALE_FACTOR`, `MUSE_ATHENA_ACC_SCALE_FACTOR`, `MUSE_ATHENA_GYRO_SCALE_FACTOR`, `MUSE_ATHENA_OPTICS_SCALE_FACTOR`, `MUSE_ATHENA_BATTERY_SCALE_FACTOR` from `./athena-constants` (Task 1).
- Produces: `parsePacket()`'s existing exported signature and 5-tuple return shape (`[nextIndex, type, entries, samples, freqHz]`) are unchanged — only the numeric scale factors and the battery payload length behavior change. `SENSOR_CONFIG[0x88].dataLen` becomes `20` (was `188`).

This task only touches the per-tag scaling math and the battery fixed-length fix. Packet/notification framing (`parseAthenaNotification`) is Task 3.

- [ ] **Step 1: Write the failing tests**

In `src/lib/athena-parser.spec.ts`, add the import at the top (alongside the existing `import { channelNames, parsePacket } from './athena-parser';`):

```ts
import { MUSE_ATHENA_EEG_SCALE_FACTOR, MUSE_ATHENA_BATTERY_SCALE_FACTOR } from './athena-constants';
```

Replace the existing test named `'scales Athena EEG values around zero using the offset-binary midpoint'` (this test's premise — subtracting an 8192 offset — is exactly what BrainFlow does not do, and what this task removes) with:

```ts
it('scales Athena EEG values using BrainFlow\'s raw scale factor with no offset subtraction', () => {
    const eegValues = [0, 8192, 16383, 1, ...new Array(12).fill(0)];
    const payload = packUnsignedValues(eegValues, 14);
    const packet = new Uint8Array(1 + 4 + payload.length);

    packet[0] = 0x12;
    packet.set(payload, 5);

    const [, type, entries] = parsePacket(packet, 0x12, 0, false);

    expect(type).toBe('EEG');
    expect(entries[0].data[0]).toBeCloseTo(0 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
    expect(entries[0].data[1]).toBeCloseTo(8192 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
    expect(entries[0].data[2]).toBeCloseTo(16383 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
    expect(entries[0].data[3]).toBeCloseTo(1 * MUSE_ATHENA_EEG_SCALE_FACTOR, 6);
});
```

Replace the existing test named `'parses 0x88 battery packets from the first two payload bytes and consumes the full payload'` (this test's premise — a variable-length payload consuming the whole buffer — is exactly what this task replaces with BrainFlow's fixed 20-byte length) with:

```ts
it('parses 0x88 battery packets from a fixed 20-byte payload, ignoring trailing bytes', () => {
    const payload = new Uint8Array(30);
    payload[0] = 0xae;
    payload[1] = 0x62;
    payload[25] = 0xff; // beyond the fixed 20-byte payload; must not affect parsing

    const packet = new Uint8Array(1 + 4 + payload.length);
    packet[0] = 0x88;
    packet.set(payload, 5);

    const [nextIdx, type, entries, samples, freqHz] = parsePacket(packet, 0x88, 0, false);

    expect(type).toBe('BATTERY');
    expect(samples).toBe(1);
    expect(freqHz).toBe(0.2);
    expect(nextIdx).toBe(5 + 20); // fixed 20-byte payload, not the full 30-byte buffer
    expect(entries).toEqual([{ type: 'BATTERY', data: [0x62ae * MUSE_ATHENA_BATTERY_SCALE_FACTOR] }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/athena-parser.spec.ts`
Expected: FAIL on both new/replaced tests — the EEG test fails because the current code still subtracts 8192 and uses the old `1450/16383` scale; the battery test fails because `nextIdx` currently equals `packet.length` (35) instead of `25`, and the value still divides by 256.

- [ ] **Step 3: Update `athena-parser.ts`**

Add the import near the top of `src/lib/athena-parser.ts` (after the existing type-only imports, before `ATHENA_FREQ_MAP`):

```ts
import {
    MUSE_ATHENA_EEG_SCALE_FACTOR,
    MUSE_ATHENA_ACC_SCALE_FACTOR,
    MUSE_ATHENA_GYRO_SCALE_FACTOR,
    MUSE_ATHENA_OPTICS_SCALE_FACTOR,
    MUSE_ATHENA_BATTERY_SCALE_FACTOR,
} from './athena-constants';
```

Remove the local scale constants (currently lines 74-77):

```ts
const EEG_SCALE = 1450 / 16383;
const ACC_SCALE = 0.0000610352;
const GYRO_SCALE = -0.0074768;
const OPTICS_SCALE = 1 / 32768;
```

Change `OPTICS_INDEXES[4]` (currently `4: [4, 5, 6, 7],`) to match BrainFlow's identity channel mapping:

```ts
const OPTICS_INDEXES: Record<number, readonly number[]> = {
    4: [0, 1, 2, 3],
    8: [0, 1, 2, 3, 4, 5, 6, 7],
    16: Array.from({ length: 16 }, (_, index) => index),
};
```

Change `SENSOR_CONFIG[0x88].dataLen` from `188` to `20`:

```ts
0x88: { type: 'BATTERY', nChannels: 1, nSamples: 1, rate: 0.2, dataLen: 20 },
```

In the `case 0x11: case 0x12:` branch, replace the scaling line:

```ts
const scaled = values.map((v) => (v - 8192) * EEG_SCALE);
```

with:

```ts
const scaled = values.map((v) => v * MUSE_ATHENA_EEG_SCALE_FACTOR);
```

In the `case 0x53:` branch (DRL/REF — parsed for length-skip purposes only, never emitted downstream), replace:

```ts
const scaled = values.map((v) => (v - 8192) * EEG_SCALE);
```

with (constant rename only; this path's output is never consumed, so its offset behavior is intentionally left unchanged):

```ts
const scaled = values.map((v) => (v - 8192) * MUSE_ATHENA_EEG_SCALE_FACTOR);
```

In the `case 0x47:` branch, replace:

```ts
const accScaled = vals.slice(base, base + 3).map((x) => x * ACC_SCALE);
const gyroScaled = vals.slice(base + 3, base + 6).map((x) => x * GYRO_SCALE);
```

with:

```ts
const accScaled = vals.slice(base, base + 3).map((x) => x * MUSE_ATHENA_ACC_SCALE_FACTOR);
const gyroScaled = vals.slice(base + 3, base + 6).map((x) => x * MUSE_ATHENA_GYRO_SCALE_FACTOR);
```

In the `case 0x34:`, `case 0x35:`, and `case 0x36:` branches (three occurrences), replace each:

```ts
.map((x) => x * OPTICS_SCALE);
```

with:

```ts
.map((x) => x * MUSE_ATHENA_OPTICS_SCALE_FACTOR);
```

(0x36 uses `values.slice(0, sensor.nChannels).map((x) => x * OPTICS_SCALE);` — same replacement, just note it isn't inside the `for (let s ...)` loop like 0x34/0x35.)

Replace the entire `case 0x88: case 0x98:` branch:

```ts
case 0x88:
case 0x98: {
    // Newer Athena firmware sends a long status packet where the first 2 bytes
    // contain state-of-charge in 1/256 percent units.
    const endIndex = data.length;
    if (payloadStart + 2 > endIndex) return [tagIndex + 1, 'BATTERY_PARTIAL', [], 1, 0];

    const block = data.subarray(payloadStart, endIndex);
    const batteryPercent = (block[0] | (block[1] << 8)) / 256;
    return [
        endIndex,
        sensor.type,
        [{ type: sensor.type, data: [batteryPercent] }],
        sensor.nSamples,
        sensor.rate,
    ];
}
```

with:

```ts
case 0x88:
case 0x98: {
    const payloadLen = sensor.dataLen;
    const endIndex = payloadStart + payloadLen;
    if (endIndex > data.length) return [tagIndex + 1, 'BATTERY_PARTIAL', [], 1, 0];

    const block = data.subarray(payloadStart, endIndex);
    const batteryPercent = (block[0] | (block[1] << 8)) * MUSE_ATHENA_BATTERY_SCALE_FACTOR;
    return [
        endIndex,
        sensor.type,
        [{ type: sensor.type, data: [batteryPercent] }],
        sensor.nSamples,
        sensor.rate,
    ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/athena-parser.spec.ts`
Expected: PASS (all tests in the file, including the two new ones and all previously-passing ones — the `'parses 0x11 EEG packets as 4 channels with 4 samples'` and `'exports Athena channel names...'` tests are unaffected by these changes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/athena-parser.ts src/lib/athena-parser.spec.ts
git commit -m "fix: align EEG/OPTICAL/BATTERY scale factors and battery payload length with BrainFlow"
```

---

### Task 3: Add `parseAthenaNotification` (multi-packet framing, 16-bit packet index)

**Files:**
- Modify: `src/lib/athena-parser.ts`
- Modify: `src/lib/athena-parser.spec.ts`

**Interfaces:**
- Consumes: `PACKET_HEADER_SIZE`, `SUBPACKET_HEADER_SIZE` from `./athena-constants` (Task 1); the existing `parsePacket(data, tag, tagIndex, verbose)` and module-scoped `SENSOR_CONFIG` (both already defined in `athena-parser.ts`).
- Produces (new exports from `src/lib/athena-parser.ts`, consumed by Task 5):
  ```ts
  export interface AthenaParsedBlock {
      packageNum: number; // (packetIndex << 8) | blockIndex
      tag: number;
      type: string;
      entries: AthenaEntry[];
      samples: number;
      freqHz: number;
  }
  export interface AthenaParsedPacket {
      packetIndex: number; // 16-bit little-endian sequence number from the packet header
      blocks: AthenaParsedBlock[];
  }
  export function parseAthenaNotification(data: Uint8Array): AthenaParsedPacket[]
  ```

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/athena-parser.spec.ts`, after the existing `packUnsignedValues` helper, a new helper for building framed physical packets:

```ts
function buildPhysicalPacket(options: {
    packetIndex: number;
    primaryTag: number;
    primaryBlockIndex: number;
    primaryPayload: Uint8Array;
    subpackets?: Array<{ tag: number; index: number; payload: Uint8Array }>;
}): Uint8Array {
    const subpackets = options.subpackets ?? [];
    const subpacketsSize = subpackets.reduce((sum, s) => sum + 5 + s.payload.length, 0);
    const packetLen = 14 + options.primaryPayload.length + subpacketsSize;
    const packet = new Uint8Array(packetLen);

    packet[0] = packetLen;
    packet[1] = options.packetIndex & 0xff;
    packet[2] = (options.packetIndex >> 8) & 0xff;
    packet[9] = options.primaryTag;
    packet[10] = options.primaryBlockIndex;
    packet.set(options.primaryPayload, 14);

    let offset = 14 + options.primaryPayload.length;
    for (const sub of subpackets) {
        packet[offset] = sub.tag;
        packet[offset + 1] = sub.index;
        packet.set(sub.payload, offset + 5);
        offset += 5 + sub.payload.length;
    }

    return packet;
}
```

Add a new `describe('parseAthenaNotification', ...)` block at the end of the file:

```ts
describe('parseAthenaNotification', () => {
    it('parses a single physical packet with a primary EEG tag', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 9,
            primaryTag: 0x12,
            primaryBlockIndex: 3,
            primaryPayload: new Uint8Array(28), // 0x12 fixed payload length
        });

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(1);
        expect(result[0].packetIndex).toBe(9);
        expect(result[0].blocks).toHaveLength(1);
        expect(result[0].blocks[0].type).toBe('EEG');
        expect(result[0].blocks[0].packageNum).toBe((9 << 8) | 3);
    });

    it('splits two physical packets concatenated in one notification', () => {
        const packet1 = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x88,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(20),
        });
        const packet2 = buildPhysicalPacket({
            packetIndex: 2,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const combined = new Uint8Array(packet1.length + packet2.length);
        combined.set(packet1, 0);
        combined.set(packet2, packet1.length);

        const result = parseAthenaNotification(combined);

        expect(result).toHaveLength(2);
        expect(result[0].blocks[0].type).toBe('BATTERY');
        expect(result[1].blocks[0].type).toBe('EEG');
    });

    it('stops parsing when packetLen is invalid', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        packet[0] = 255; // declares far more data than actually present

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(0);
    });

    it('abandons a physical packet with an unrecognized primary tag but still parses the next physical packet', () => {
        const unknownPrimaryPacket = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x7f, // not in SENSOR_CONFIG
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const eegPacket = buildPhysicalPacket({
            packetIndex: 2,
            primaryTag: 0x12,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(28),
        });
        const combined = new Uint8Array(unknownPrimaryPacket.length + eegPacket.length);
        combined.set(unknownPrimaryPacket, 0);
        combined.set(eegPacket, unknownPrimaryPacket.length);

        const result = parseAthenaNotification(combined);

        expect(result).toHaveLength(2);
        expect(result[0].blocks).toHaveLength(0);
        expect(result[1].blocks[0].type).toBe('EEG');
    });

    it('stops the subpacket scan at an unrecognized subpacket tag but keeps earlier subpackets', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 1,
            primaryTag: 0x88,
            primaryBlockIndex: 0,
            primaryPayload: new Uint8Array(20),
            subpackets: [
                { tag: 0x47, index: 0, payload: new Uint8Array(36) }, // recognized ACC_GYRO
                { tag: 0x7f, index: 1, payload: new Uint8Array(28) }, // unrecognized -> stop here
                { tag: 0x12, index: 2, payload: new Uint8Array(28) }, // never reached
            ],
        });

        const result = parseAthenaNotification(packet);

        expect(result).toHaveLength(1);
        expect(result[0].blocks.map((b) => b.type)).toEqual(['BATTERY', 'ACC_GYRO']);
    });

    it('composes a 16-bit packageNum from packetIndex and blockIndex across the 256 boundary', () => {
        const packet = buildPhysicalPacket({
            packetIndex: 511, // 0x1FF -- exercises the byte-1/byte-2 split
            primaryTag: 0x12,
            primaryBlockIndex: 7,
            primaryPayload: new Uint8Array(28),
        });

        const result = parseAthenaNotification(packet);

        expect(result[0].packetIndex).toBe(511);
        expect(result[0].blocks[0].packageNum).toBe((511 << 8) | 7);
    });
});
```

Update the top-of-file import to include the new function:

```ts
import { channelNames, parsePacket, parseAthenaNotification } from './athena-parser';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/lib/athena-parser.spec.ts`
Expected: FAIL — `parseAthenaNotification` is not exported yet (`TypeError: (0 , athena_parser_1.parseAthenaNotification) is not a function` or similar).

- [ ] **Step 3: Implement `parseAthenaNotification`**

Add to the top-of-file import in `src/lib/athena-parser.ts` (extend the import added in Task 2):

```ts
import {
    MUSE_ATHENA_EEG_SCALE_FACTOR,
    MUSE_ATHENA_ACC_SCALE_FACTOR,
    MUSE_ATHENA_GYRO_SCALE_FACTOR,
    MUSE_ATHENA_OPTICS_SCALE_FACTOR,
    MUSE_ATHENA_BATTERY_SCALE_FACTOR,
    PACKET_HEADER_SIZE,
    SUBPACKET_HEADER_SIZE,
} from './athena-constants';
```

Add at the end of `src/lib/athena-parser.ts`, after `parsePacket`:

```ts
export interface AthenaParsedBlock {
    packageNum: number;
    tag: number;
    type: string;
    entries: AthenaEntry[];
    samples: number;
    freqHz: number;
}

export interface AthenaParsedPacket {
    packetIndex: number;
    blocks: AthenaParsedBlock[];
}

/**
 * Splits a raw BLE notification into its physical Athena packets and parses every
 * primary + subpacket block found. Mirrors BrainFlow's handle_data_notification /
 * parse_sensor_payload dispatch: a notification may contain multiple concatenated
 * physical packets, and an unrecognized or malformed tag aborts only the remainder
 * of the current physical packet rather than the whole notification.
 */
export function parseAthenaNotification(data: Uint8Array): AthenaParsedPacket[] {
    const packets: AthenaParsedPacket[] = [];
    let offset = 0;

    while (offset < data.length) {
        if (data.length - offset < PACKET_HEADER_SIZE) break;

        const packetLen = data[offset];
        if (packetLen < PACKET_HEADER_SIZE || offset + packetLen > data.length) break;

        const packetIndex = data[offset + 1] | (data[offset + 2] << 8);
        const primaryTag = data[offset + 9];
        const primaryBlockIndex = data[offset + 10];
        const packetDataStart = offset + PACKET_HEADER_SIZE;
        const packetDataSize = packetLen - PACKET_HEADER_SIZE;
        let packetDataOffset = 0;
        const blocks: AthenaParsedBlock[] = [];

        const primaryConfig = SENSOR_CONFIG[primaryTag];
        if (primaryConfig && primaryConfig.dataLen > 0 && primaryConfig.dataLen <= packetDataSize) {
            const packageNum = (packetIndex << 8) | primaryBlockIndex;
            const [, type, entries, samples, freqHz] = parsePacket(data, primaryTag, offset + 9, false);
            blocks.push({ packageNum, tag: primaryTag, type, entries, samples, freqHz });
            packetDataOffset = primaryConfig.dataLen;
        } else {
            packetDataOffset = packetDataSize;
        }

        while (packetDataOffset + SUBPACKET_HEADER_SIZE <= packetDataSize) {
            const tagPos = packetDataStart + packetDataOffset;
            const tag = data[tagPos];
            const subpacketIndex = data[tagPos + 1];
            const config = SENSOR_CONFIG[tag];
            if (!config) break;

            const remaining = packetDataSize - packetDataOffset - SUBPACKET_HEADER_SIZE;
            if (config.dataLen === 0 || config.dataLen > remaining) break;

            const packageNum = (packetIndex << 8) | subpacketIndex;
            const [, type, entries, samples, freqHz] = parsePacket(data, tag, tagPos, false);
            blocks.push({ packageNum, tag, type, entries, samples, freqHz });
            packetDataOffset += SUBPACKET_HEADER_SIZE + config.dataLen;
        }

        packets.push({ packetIndex, blocks });
        offset += packetLen;
    }

    return packets;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/athena-parser.spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/athena-parser.ts src/lib/athena-parser.spec.ts
git commit -m "feat: add parseAthenaNotification for BrainFlow-style multi-packet framing"
```

---

### Task 4: Remove the dead `opticalChannel` field from `AthenaOpticalReading`

**Files:**
- Modify: `src/lib/muse-interfaces.ts:70-75`
- Modify: `demo/src/graph-model.spec.ts:18-23`

**Interfaces:**
- Produces: `AthenaOpticalReading` no longer has an `opticalChannel` field. `{ index: number; timestamp: number; samples: number[] }` remain.

Nothing in this repository reads `AthenaOpticalReading.opticalChannel` (verified by grep across `src/` and `demo/src/`) except this one test's object literal, and its value never affected any assertion output. Its doc comment (`// Channel 0-2 (ambient, IR, red)`) also does not match what the field ever actually held (an in-packet time-sample index, not a channel).

- [ ] **Step 1: Update the interface**

In `src/lib/muse-interfaces.ts`, change:

```ts
export interface AthenaOpticalReading {
    index: number; // Event index
    opticalChannel: number; // Channel 0-2 (ambient, IR, red)
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 4 optical values at 64 Hz
}
```

to:

```ts
export interface AthenaOpticalReading {
    index: number; // Event index
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 4 optical values at 64 Hz
}
```

- [ ] **Step 2: Run the demo test to verify it now fails to type-check**

Run: `npx jest demo/src/graph-model.spec.ts`
Expected: FAIL — TypeScript error, `Object literal may only specify known properties, and 'opticalChannel' does not exist in type 'AthenaOpticalReading'` at `demo/src/graph-model.spec.ts:20`.

- [ ] **Step 3: Fix the demo test**

In `demo/src/graph-model.spec.ts`, change:

```ts
            const reading: AthenaOpticalReading = {
                index,
                opticalChannel: 0,
                timestamp: 1000 + index,
                samples: [index, index + 10, index + 20],
            };
```

to:

```ts
            const reading: AthenaOpticalReading = {
                index,
                timestamp: 1000 + index,
                samples: [index, index + 10, index + 20],
            };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest demo/src/graph-model.spec.ts src/muse-athena.spec.ts`
Expected: PASS. (`src/muse-athena.spec.ts`'s existing optical test doesn't reference `opticalChannel`, but is included here as a quick check that nothing else broke; its own updates come in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/muse-interfaces.ts demo/src/graph-model.spec.ts
git commit -m "fix: remove dead opticalChannel field from AthenaOpticalReading"
```

---

### Task 5: Replace the packet-count clock with real-arrival-time timestamps, and rewire parsing onto `parseAthenaNotification`

**Files:**
- Modify: `src/muse-athena.ts`
- Modify: `src/muse-athena.spec.ts`

**Interfaces:**
- Consumes: `parseAthenaNotification` (Task 3); `MUSE_ATHENA_EEG_SCALE_FACTOR` / `MUSE_ATHENA_OPTICS_SCALE_FACTOR` from `./lib/athena-constants` (Task 1, in the spec file only).
- Produces (private members on `MuseAthenaClient`):
  ```ts
  private lastEegTimestamp: number | null
  private lastAccGyroTimestamp: number | null
  private lastOpticalTimestamp: number | null
  private resetTimestampState(): void
  private getPacketBaseTimestamp(lastTimestamp: number | null, currentTimestamp: number, nSamples: number, rateHz: number): number
  ```
  `parseAthenaPacketForType<T>(packet: Uint8Array, targetType: string): Observable<T>` and `parseAthenaBatterySync(packet: Uint8Array): AthenaBatteryData | null` keep their existing signatures but are now internally driven by `parseAthenaNotification`. Emitted readings' `index` field becomes the composite `packageNum` instead of a per-notification-shared, 8-bit-truncated value.

**Note on task sizing:** the old `eegPacketCount`/`eegBaseTimestamp`-style fields and the methods that read them (`parseAthenaPacketForType`, `parseAthenaBatterySync`) are tightly coupled — removing the fields without rewriting their only consumers in the same task would leave `src/muse-athena.ts` in a non-compiling state between tasks. So this single task adds the new timestamp model *and* rewires both consumer methods together, with one shared TDD cycle.

- [ ] **Step 1: Write the failing tests**

Add to `src/muse-athena.spec.ts`, inside the outer `describe('MuseAthenaClient', ...)` block (after the existing tests), the new `getPacketBaseTimestamp` and timestamp-reset-lifecycle tests:

```ts
    describe('getPacketBaseTimestamp', () => {
        it('backdates from current time on the first packet (last === null)', () => {
            const client = new MuseAthenaClient() as any;
            const result = client.getPacketBaseTimestamp(null, 1000, 4, 256);
            expect(result).toBeCloseTo(1000 - (3 * 1000) / 256, 6);
        });

        it('returns current time when the clock has not advanced (stale/duplicate)', () => {
            const client = new MuseAthenaClient() as any;
            const result = client.getPacketBaseTimestamp(1000, 1000, 4, 256);
            expect(result).toBe(1000);
        });

        it('interpolates forward from last timestamp at the nominal rate', () => {
            const client = new MuseAthenaClient() as any;
            const result = client.getPacketBaseTimestamp(1000, 1100, 4, 256);
            expect(result).toBeCloseTo(1000 + 1000 / 256, 6);
        });

        it('spreads evenly across the actual elapsed interval when arrival is faster than nominal', () => {
            const client = new MuseAthenaClient() as any;
            // nominal step is 1000/256 ~= 3.9ms, but only 2ms actually elapsed
            const result = client.getPacketBaseTimestamp(1000, 1002, 4, 256);
            expect(result).toBeCloseTo(1000 + (1002 - 1000) / 4, 6);
        });
    });

    describe('timestamp reset lifecycle', () => {
        it('resets all three timestamp fields to null', () => {
            const client = new MuseAthenaClient() as any;
            client.lastEegTimestamp = 123;
            client.lastAccGyroTimestamp = 456;
            client.lastOpticalTimestamp = 789;

            client.resetTimestampState();

            expect(client.lastEegTimestamp).toBeNull();
            expect(client.lastAccGyroTimestamp).toBeNull();
            expect(client.lastOpticalTimestamp).toBeNull();
        });

        it('resets timestamp state on start, pause, resume, and stop', async () => {
            const client = new MuseAthenaClient();
            const delaySpy = jest
                .spyOn(MuseAthenaClient.prototype as any, 'delay')
                .mockImplementation(() => Promise.resolve());
            const resetSpy = jest.spyOn(MuseAthenaClient.prototype as any, 'resetTimestampState');
            const service = museDevice.getServiceMock(0xfe8d);
            const controlCharacteristic = service.getCharacteristicMock('273e0001-4c4d-454d-96be-f03bac821358');
            (controlCharacteristic as any).writeValueWithoutResponse = jest.fn().mockResolvedValue(undefined);

            try {
                await client.connect();
                await client.start();
                expect(resetSpy).toHaveBeenCalledTimes(1);

                await client.pause();
                expect(resetSpy).toHaveBeenCalledTimes(2);

                await client.resume();
                expect(resetSpy).toHaveBeenCalledTimes(3);

                await client.stop();
                expect(resetSpy).toHaveBeenCalledTimes(4);
            } finally {
                delaySpy.mockRestore();
                resetSpy.mockRestore();
            }
        });

        it('resets timestamp state on disconnect', async () => {
            const client = new MuseAthenaClient();
            const resetSpy = jest.spyOn(MuseAthenaClient.prototype as any, 'resetTimestampState');

            try {
                await client.connect();
                resetSpy.mockClear();
                client.disconnect();
                expect(resetSpy).toHaveBeenCalledTimes(1);
            } finally {
                resetSpy.mockRestore();
            }
        });
    });
```

Fix the existing `'deinterleaves EEG samples into channel readings'` test. Replace:

```ts
    it('deinterleaves EEG samples into channel readings', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

        // Create 8 channels * 2 samples = 16 sequential 14-bit values
        const eegValues = Array.from({ length: 16 }, (_, i) => i + 1);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);
        packet[1] = 9;
        packet[9] = 0x12; // 8-channel EEG tag
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; electrode: number; samples: number[] }> = [];
        client.eegReadings.subscribe((r) =>
            readings.push({ index: r.index, electrode: r.electrode, samples: r.samples }),
        );

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        // Expect one reading per channel (8 channels) with 2 samples each and verify scaling + ordering
        expect(readings).toHaveLength(8);
        const EEG_SCALE = 1450 / 16383;
        for (let i = 0; i < 8; i++) {
            const r = readings[i];
            expect(r.electrode).toBe(i);
            expect(r.samples.length).toBe(2);
            const v0 = (i + 1 - 8192) * EEG_SCALE;
            const v1 = (i + 1 + 8 - 8192) * EEG_SCALE;
            expect(r.samples[0]).toBeCloseTo(v0, 5);
            expect(r.samples[1]).toBeCloseTo(v1, 5);
        }
    });
```

with:

```ts
    it('deinterleaves EEG samples into channel readings', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

        // Create 8 channels * 2 samples = 16 sequential 14-bit values
        const eegValues = Array.from({ length: 16 }, (_, i) => i + 1);
        const payload = packUnsignedValues(eegValues, 14);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);
        packet[0] = packet.length; // packetLen framing byte required by parseAthenaNotification
        packet[1] = 9;
        packet[9] = 0x12; // 8-channel EEG tag
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; electrode: number; samples: number[] }> = [];
        client.eegReadings.subscribe((r) =>
            readings.push({ index: r.index, electrode: r.electrode, samples: r.samples }),
        );

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        // Expect one reading per channel (8 channels) with 2 samples each and verify scaling + ordering
        expect(readings).toHaveLength(8);
        for (let i = 0; i < 8; i++) {
            const r = readings[i];
            expect(r.electrode).toBe(i);
            expect(r.samples.length).toBe(2);
            const v0 = (i + 1) * MUSE_ATHENA_EEG_SCALE_FACTOR;
            const v1 = (i + 1 + 8) * MUSE_ATHENA_EEG_SCALE_FACTOR;
            expect(r.samples[0]).toBeCloseTo(v0, 5);
            expect(r.samples[1]).toBeCloseTo(v1, 5);
        }
    });
```

Fix the existing `'emits Athena optical readings with one value per optical sensor'` test. Replace:

```ts
    it('emits Athena optical readings with one value per optical sensor', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');
        const opticalValues = Array.from({ length: 16 }, (_, index) => index + 1);
        const payload = packUnsignedValues(opticalValues, 20);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);

        packet[1] = 9;
        packet[9] = 0x35;
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; samples: number[] }> = [];
        client.opticalReadings.subscribe((reading) => {
            readings.push({ index: reading.index, samples: reading.samples });
        });

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        expect(readings).toHaveLength(2);
        expect(readings[0].samples).toHaveLength(8);
        expect(readings[1].samples).toHaveLength(8);

        const OPTICS_SCALE = 1 / 32768;
        // First reading should contain values 1..8 scaled
        for (let i = 0; i < 8; i++) {
            expect(readings[0].samples[i]).toBeCloseTo((i + 1) * OPTICS_SCALE, 8);
        }
        // Second reading should contain values 9..16 scaled
        for (let i = 0; i < 8; i++) {
            expect(readings[1].samples[i]).toBeCloseTo((i + 9) * OPTICS_SCALE, 8);
        }
    });
```

with:

```ts
    it('emits Athena optical readings with one value per optical sensor', async () => {
        const client = new MuseAthenaClient();
        const service = museDevice.getServiceMock(0xfe8d);
        const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');
        const opticalValues = Array.from({ length: 16 }, (_, index) => index + 1);
        const payload = packUnsignedValues(opticalValues, 20);
        const packet = new Uint8Array(9 + 1 + 4 + payload.length);

        packet[0] = packet.length; // packetLen framing byte required by parseAthenaNotification
        packet[1] = 9;
        packet[9] = 0x35;
        packet.set(payload, 14);

        await client.connect();

        const readings: Array<{ index: number; samples: number[] }> = [];
        client.opticalReadings.subscribe((reading) => {
            readings.push({ index: reading.index, samples: reading.samples });
        });

        sensorCharacteristic.value = new DataView(packet.buffer);
        sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

        expect(readings).toHaveLength(2);
        expect(readings[0].samples).toHaveLength(8);
        expect(readings[1].samples).toHaveLength(8);

        // First reading should contain values 1..8 (scale factor is 1.0 -- no-op)
        for (let i = 0; i < 8; i++) {
            expect(readings[0].samples[i]).toBeCloseTo((i + 1) * MUSE_ATHENA_OPTICS_SCALE_FACTOR, 8);
        }
        // Second reading should contain values 9..16
        for (let i = 0; i < 8; i++) {
            expect(readings[1].samples[i]).toBeCloseTo((i + 9) * MUSE_ATHENA_OPTICS_SCALE_FACTOR, 8);
        }
    });
```

Add the new import at the top of `src/muse-athena.spec.ts` (alongside the existing imports):

```ts
import { MUSE_ATHENA_EEG_SCALE_FACTOR, MUSE_ATHENA_OPTICS_SCALE_FACTOR } from './lib/athena-constants';
```

Add a new test proving timestamps now anchor to real arrival time instead of a fixed-rate counter (place it in its own `describe` block, after the `timestamp reset lifecycle` block above):

```ts
    describe('EEG packet timestamps', () => {
        it('anchors to real arrival time instead of a fixed-rate counter', async () => {
            const client = new MuseAthenaClient();
            const service = museDevice.getServiceMock(0xfe8d);
            const sensorCharacteristic = service.getCharacteristicMock('273e0013-4c4d-454d-96be-f03bac821358');

            await client.connect();

            const timestamps: number[] = [];
            client.eegReadings.subscribe((r) => {
                if (r.electrode === 0) timestamps.push(r.timestamp);
            });

            const eegValues = new Array(16).fill(8192);
            const payload = packUnsignedValues(eegValues, 14);
            const buildPacket = () => {
                const packet = new Uint8Array(14 + payload.length);
                packet[0] = packet.length;
                packet[1] = 1;
                packet[9] = 0x12;
                packet.set(payload, 14);
                return packet;
            };

            const nowSpy = jest.spyOn(Date, 'now');
            try {
                nowSpy.mockReturnValueOnce(1_000_000);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));

                // 50ms later -- far more than one nominal 2-sample EEG step (~7.8ms)
                nowSpy.mockReturnValueOnce(1_000_050);
                sensorCharacteristic.value = new DataView(buildPacket().buffer);
                sensorCharacteristic.dispatchEvent(new CustomEvent('characteristicvaluechanged'));
            } finally {
                nowSpy.mockRestore();
            }

            expect(timestamps).toHaveLength(2);
            // n_samples=2 for tag 0x12 -> backdate by (2-1)/256 seconds on the first packet
            expect(timestamps[0]).toBeCloseTo(1_000_000 - 1000 / 256, 6);
            // anchored to the previous packet's real arrival time (1_000_000), not the new
            // arrival time (1_000_050) and not a fixed 1_000_000-epoch-plus-count clock
            expect(timestamps[1]).toBeCloseTo(1_000_000 + 1000 / 256, 6);
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/muse-athena.spec.ts`
Expected: FAIL — `client.getPacketBaseTimestamp is not a function` and `client.resetTimestampState is not a function` on the new unit tests; the `'deinterleaves EEG samples...'` and `'emits Athena optical readings...'` tests fail on the updated scale-factor assertions (the current code still subtracts 8192 for EEG and divides by 32768 for optical); the new `'anchors to real arrival time...'` test fails because the current code still uses the fixed-rate packet-count clock instead of interpolating from real arrival time.

- [ ] **Step 3: Implement the new timestamp model and rewire the parsing methods**

In `src/muse-athena.ts`, replace the timestamp tracking state fields (currently):

```ts
    // Timestamp tracking state - packet count based (matches BrainFlow's high-res approach)
    private eegPacketCount = 0;
    private eegBaseTimestamp = 0;
    private accGyroPacketCount = 0;
    private accGyroBaseTimestamp = 0;
    private opticalPacketCount = 0;
    private opticalBaseTimestamp = 0;
```

with:

```ts
    // Timestamp tracking state - last real arrival time per sensor type (matches
    // BrainFlow's get_sample_timestamp / reset_timestamps).
    private lastEegTimestamp: number | null = null;
    private lastAccGyroTimestamp: number | null = null;
    private lastOpticalTimestamp: number | null = null;
```

Change the import:

```ts
import { parsePacket } from './lib/athena-parser';
```

to:

```ts
import { parseAthenaNotification } from './lib/athena-parser';
```

Add two new private methods (placed near `parseAthenaPacketForType`, e.g. immediately before it):

```ts
    private resetTimestampState(): void {
        this.lastEegTimestamp = null;
        this.lastAccGyroTimestamp = null;
        this.lastOpticalTimestamp = null;
    }

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

Update `start()` — add a reset call as the first line of the method body:

```ts
    async start(preset: AthenaPreset = 'p1045') {
        this.resetTimestampState();
        console.log('[Athena] Starting sequence');
        await this.sendCommand('v4');
```
(rest of the method is unchanged)

Update `stop()`:

```ts
    async stop() {
        this.resetTimestampState();
        try {
            await this.sendCommand('h');
        } catch {
            // Already stopped or disconnected
        }
    }
```

Update `pause()`:

```ts
    async pause() {
        this.resetTimestampState();
        await this.sendCommand('h');
    }
```

Update `resume()`:

```ts
    async resume() {
        this.resetTimestampState();
        await this.sendCommand('dc001');
    }
```

Update `disconnect()` — replace the manual field resets:

```ts
    disconnect() {
        if (this.gatt) {
            this.eegPacketCount = 0;
            this.eegBaseTimestamp = 0;
            this.accGyroPacketCount = 0;
            this.accGyroBaseTimestamp = 0;
            this.opticalPacketCount = 0;
            this.opticalBaseTimestamp = 0;
            if (this.gatt.connected) this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }
```

with:

```ts
    disconnect() {
        if (this.gatt) {
            this.resetTimestampState();
            if (this.gatt.connected) this.gatt.disconnect();
            this.connectionStatus.next(false);
        }
    }
```

Replace the entire `parseAthenaPacketForType` method:

```ts
    private parseAthenaPacketForType<T>(packet: Uint8Array, targetType: string): Observable<T> {
        return new Observable<T>((observer) => {
            if (packet.length < 10) {
                observer.complete();
                return;
            }
            const eventIndex = packet[1];
            let idx = 9;

            while (idx < packet.length) {
                const tag = packet[idx];
                try {
                    const [nextIdx, type, entries, samples, freqHz] = parsePacket(packet, tag, idx, false);
                    if (type === targetType) {
                        if (type === 'EEG') {
                            // Initialize base timestamp on first packet
                            if (this.eegBaseTimestamp === 0) {
                                this.eegBaseTimestamp = Date.now();
                            }
                            // Calculate packet timestamp based on packet count (fixed delta)
                            const SAMPLES_PER_PACKET = samples; // 2 for EEG
                            const packetTimestamp =
                                this.eegBaseTimestamp + (this.eegPacketCount * SAMPLES_PER_PACKET * 1000) / freqHz;

                            for (const entry of entries) {
                                const allSamples = entry.data;
                                const channels = allSamples.length / samples;
                                for (let ch = 0; ch < channels; ch++) {
                                    const samplesArr = Array.from({ length: samples }, (_, sampleIndex) => {
                                        return allSamples[sampleIndex * channels + ch];
                                    });
                                    // Each sample gets its own timestamp within the packet
                                    const sampleTimestamp = packetTimestamp;
                                    observer.next({
                                        index: eventIndex,
                                        electrode: ch,
                                        timestamp: sampleTimestamp,
                                        samples: samplesArr,
                                    } as unknown as T);
                                }
                            }
                            this.eegPacketCount++;
                        } else if (type === 'ACC_GYRO') {
                            // Initialize base timestamp on first packet
                            if (this.accGyroBaseTimestamp === 0) {
                                this.accGyroBaseTimestamp = Date.now();
                            }
                            // Calculate packet timestamp based on packet count (fixed delta)
                            const packetTimestamp =
                                this.accGyroBaseTimestamp + (this.accGyroPacketCount * samples * 1000) / freqHz;

                            for (let i = 0; i < samples; i++) {
                                const accEntry = entries[i * 2];
                                const gyroEntry = entries[i * 2 + 1];
                                if (accEntry && accEntry.type === 'ACC') {
                                    observer.next({
                                        index: eventIndex,
                                        timestamp: packetTimestamp,
                                        acc: { x: accEntry.data[0], y: accEntry.data[1], z: accEntry.data[2] },
                                        gyro: {
                                            x: gyroEntry?.data[0] || 0,
                                            y: gyroEntry?.data[1] || 0,
                                            z: gyroEntry?.data[2] || 0,
                                        },
                                    } as unknown as T);
                                }
                            }
                            this.accGyroPacketCount++;
                        } else if (type === 'OPTICAL') {
                            // Initialize base timestamp on first packet
                            if (this.opticalBaseTimestamp === 0) {
                                this.opticalBaseTimestamp = Date.now();
                            }
                            // Calculate packet timestamp based on packet count (fixed delta)
                            const packetTimestamp =
                                this.opticalBaseTimestamp + (this.opticalPacketCount * samples * 1000) / freqHz;

                            for (let i = 0; i < samples; i++) {
                                const optEntry = entries[i];
                                if (optEntry && optEntry.type === 'OPTICAL') {
                                    observer.next({
                                        index: eventIndex,
                                        opticalChannel: i % 3,
                                        timestamp: packetTimestamp,
                                        samples: optEntry.data,
                                    } as unknown as T);
                                }
                            }
                            this.opticalPacketCount++;
                        }
                    }

                    if (nextIdx <= idx) {
                        idx += 1;
                    } else {
                        idx = nextIdx;
                    }
                } catch {
                    idx += 1;
                }
            }
            observer.complete();
        });
    }
```

with:

```ts
    private parseAthenaPacketForType<T>(packet: Uint8Array, targetType: string): Observable<T> {
        return new Observable<T>((observer) => {
            const physicalPackets = parseAthenaNotification(packet);

            for (const physicalPacket of physicalPackets) {
                const matchingBlocks = physicalPacket.blocks.filter((block) => block.type === targetType);
                if (matchingBlocks.length === 0) continue;

                const hostTimestamp = Date.now();

                for (const block of matchingBlocks) {
                    const { packageNum: eventIndex, entries, samples, freqHz } = block;

                    if (targetType === 'EEG') {
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastEegTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastEegTimestamp = hostTimestamp;

                        for (const entry of entries) {
                            const allSamples = entry.data;
                            const channels = allSamples.length / samples;
                            for (let ch = 0; ch < channels; ch++) {
                                const samplesArr = Array.from({ length: samples }, (_, sampleIndex) => {
                                    return allSamples[sampleIndex * channels + ch];
                                });
                                observer.next({
                                    index: eventIndex,
                                    electrode: ch,
                                    timestamp: packetTimestamp,
                                    samples: samplesArr,
                                } as unknown as T);
                            }
                        }
                    } else if (targetType === 'ACC_GYRO') {
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastAccGyroTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastAccGyroTimestamp = hostTimestamp;

                        for (let i = 0; i < samples; i++) {
                            const accEntry = entries[i * 2];
                            const gyroEntry = entries[i * 2 + 1];
                            if (accEntry && accEntry.type === 'ACC') {
                                observer.next({
                                    index: eventIndex,
                                    timestamp: packetTimestamp,
                                    acc: { x: accEntry.data[0], y: accEntry.data[1], z: accEntry.data[2] },
                                    gyro: {
                                        x: gyroEntry?.data[0] || 0,
                                        y: gyroEntry?.data[1] || 0,
                                        z: gyroEntry?.data[2] || 0,
                                    },
                                } as unknown as T);
                            }
                        }
                    } else if (targetType === 'OPTICAL') {
                        const packetTimestamp = this.getPacketBaseTimestamp(
                            this.lastOpticalTimestamp,
                            hostTimestamp,
                            samples,
                            freqHz,
                        );
                        this.lastOpticalTimestamp = hostTimestamp;

                        for (let i = 0; i < samples; i++) {
                            const optEntry = entries[i];
                            if (optEntry && optEntry.type === 'OPTICAL') {
                                observer.next({
                                    index: eventIndex,
                                    timestamp: packetTimestamp,
                                    samples: optEntry.data,
                                } as unknown as T);
                            }
                        }
                    }
                }
            }

            observer.complete();
        });
    }
```

Replace the entire `parseAthenaBatterySync` method:

```ts
    private parseAthenaBatterySync(packet: Uint8Array): AthenaBatteryData | null {
        if (packet.length < 10) return null;
        let idx = 9;
        while (idx < packet.length) {
            const tag = packet[idx];
            try {
                const [nextIdx, type, entries] = parsePacket(packet, tag, idx, false);
                if (type === 'BATTERY') {
                    return { timestamp: Date.now(), values: entries[0].data };
                }
                idx = nextIdx;
            } catch {
                idx += 1;
            }
        }
        return null;
    }
```

with:

```ts
    private parseAthenaBatterySync(packet: Uint8Array): AthenaBatteryData | null {
        const physicalPackets = parseAthenaNotification(packet);
        for (const physicalPacket of physicalPackets) {
            const batteryBlock = physicalPacket.blocks.find((block) => block.type === 'BATTERY');
            if (batteryBlock) {
                return { timestamp: Date.now(), values: batteryBlock.entries[0].data };
            }
        }
        return null;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/muse-athena.spec.ts`
Expected: PASS (every test in the file, including all newly added ones).

- [ ] **Step 5: Commit**

```bash
git add src/muse-athena.ts src/muse-athena.spec.ts
git commit -m "fix: replace packet-count timestamp clock with real-arrival-time model and rewire extraction through parseAthenaNotification"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and linter**

Run: `npm run test`
Expected: PASS — `eslint src/**/*.ts demo/src/**/*.ts` reports no errors, and every `**/*.spec.ts` file (including `src/lib/athena-constants.spec.ts`, `src/lib/athena-parser.spec.ts`, `src/muse-athena.spec.ts`, `src/lib/zip-samples.spec.ts`, `src/lib/zip-samplesPpg.spec.ts`, `src/lib/muse-parse.spec.ts`, `src/lib/muse-utils.spec.ts`, `demo/src/graph-model.spec.ts`) passes.

- [ ] **Step 2: If lint fails on formatting, fix and re-run**

If `eslint` reports formatting issues (rather than logic errors) in any file touched by Tasks 1-5, run:

```bash
npx prettier --write "src/**/*.ts" "demo/src/**/*.ts"
```

then re-run `npm run test`. Do not use `eslint --fix` for anything beyond formatting without reviewing the diff first — this repo does not silence lint failures.

- [ ] **Step 3: Commit any formatting fixes**

Only if Step 2 produced changes:

```bash
git add -u
git commit -m "chore: fix formatting"
```

If Step 1 passed cleanly with no changes needed, there is nothing to commit for this task.
