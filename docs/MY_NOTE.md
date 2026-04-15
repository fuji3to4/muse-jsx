# Development Notes

## Observations

### Battery-Related
- The battery tag was documented as `0x98` in reference code, but the actual Athena device sends it as `0x88`
- Battery data is sent as an array with multiple values, but the detailed specification is unknown
- There is a numeric value that gradually decreases with usage time; the demo site displays this value as-is

### About Presets
- Currently launches with `p1045` as the default preset
- Other presets exist: `p1034`, `p1035`, `p21`, etc.
- The current implementation can retrieve data with any preset, but frequency settings are not properly applied
- There's a possibility that data is not being captured correctly

### EEG Data Characteristics
- When outputting EEG in real-time on the demo site, it appears to have more noise than Muse S (Classic)
- Scale factor adjustment may be necessary
- EEG characteristics differ between presets, which is concerning
- However, all presets respond to muscle activity such as eye blinks

### Packet Structure
- Packet ID is stored in the byte at index=9

Based on the [OpenMuse](https://github.com/DominiqueMakowski/OpenMuse)
project's `decode.py`:

```
byte[0]      packet length
bytes[1..9]  header (pkt_index, device clock, metadata)
byte[9]      first subpacket tag (sensor type)
bytes[10..13] 4-byte subpacket metadata
bytes[14..]  first subpacket payload, then additional [TAG][META4][PAYLOAD]…
```

The first subpacket's type is given by `byte[9]`; subsequent subpackets each
carry their own 1-byte tag + 4-byte metadata header before the payload.

---

## Packet ID Byte Specification

### Upper 4 bits (Frequency)
- `0` = Frequency not valid
- `1` = 256 Hz
- `2` = 128 Hz
- `3` = 64 Hz
- `4` = 52 Hz
- `5` = 32 Hz
- `6` = 16 Hz
- `7` = 10 Hz
- `8` = 1 Hz
- `9` = 0.1 Hz

### Lower 4 bits (Data Type)
- `0` = Not valid
- `1` = EEG (4 channels)
- `2` = EEG (8 channels)
- `3` = DRL/REF
- `4` = Optics (4 channels)
- `5` = Optics (8 channels)
- `6` = Optics (16 channels)
- `7` = Accelerometer + Gyroscope
- `8` = Battery

---

#### Known tags

Tags use the full byte value — payload sizes depend on the specific tag, not
just the lower nibble.

| Tag  | Sensor       | Payload    | Channels | Samples/ch | Rate    |
|------|--------------|------------|----------|------------|---------|
| `0x11` | EEG 4ch    | 28 B       | 4        | 4          | 256 Hz  |
| `0x12` | EEG 8ch    | 28 B       | 8        | 2          | 256 Hz  |
| `0x34` | Optical 4ch | 30 B      | 4        | 3          | 64 Hz   |
| `0x35` | Optical 8ch | 40 B      | 8        | 2          | 64 Hz   |
| `0x36` | Optical 16ch| 40 B      | 16       | 1          | 64 Hz   |
| `0x47` | IMU         | 36 B      | 6        | 3          | 52 Hz   |
| `0x53` | DRL/REF     | 24 B      | –        | –          | 32 Hz   |
| `0x88` | Battery (new fw) | 188–230 B | 1   | 1          | ~0.2 Hz |
| `0x98` | Battery (old fw) | 20 B  | 1        | 1          | 1 Hz    |

**EEG scale:** `µV = (raw₁₄ − 8192) × 0.0885`

**EEG channels (index order):** TP9, AF7, AF8, TP10, FPz, AUX\_R, AUX\_L, AUX
(the first 4 are the standard electrode positions; indices 4–7 are extended
channels only available on Athena hardware).

**IMU:** accelerometer scale = 0.0000610352 g/LSB (same as Classic);
gyroscope scale = −0.0074768 °/s/LSB (negated vs. Classic).

**Battery:** first 2 bytes of payload = u16 LE, divide by 256.0 for percentage.
Confirmed by matching against the `bp` field in the Athena control JSON
response and independently verified by the
[OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) project.

**Startup sequence:** `v4` → `s` → `h` → `p1045` → `dc001` × 2 → `d` (fallback) → `L1` → 2 s wait

**Resume command:** `dc001` + `d` (both sent for compatibility with fw 3.x)

## References
- [AbosaSzakal/MuseAthenaDataformatParser](https://github.com/AbosaSzakal/MuseAthenaDataformatParser)
