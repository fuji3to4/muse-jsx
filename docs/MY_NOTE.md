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

## References
- [AbosaSzakal/MuseAthenaDataformatParser](https://github.com/AbosaSzakal/MuseAthenaDataformatParser)
