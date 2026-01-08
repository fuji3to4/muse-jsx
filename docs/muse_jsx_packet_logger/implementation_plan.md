# Implementation Plan: Athena Packet Logger

## 1. MuseAthenaClient Updates (`src/muse-athena.ts`)
- [ ] Export `AthenaPreset` type (union of available preset keys).
- [ ] Export `ATHENA_PRESETS` array for UI consumption.
- [ ] Add `rawPackets` Subject/Observable to `MuseAthenaClient` interface.
    - Type: `{ timestamp: number, uuid: string, data: Uint8Array }`.
- [ ] Update `logRawAthenaPacket` (or where it's called) to emit to `rawPackets`.

## 2. App Component Updates (`demo/src/App.tsx`)
- [ ] Add state: `currentView` ('graph' | 'logger').
- [ ] Add state: `selectedPreset` (default 'p1045').
- [ ] Add state: `logs` (array of packet objects).
- [ ] Add state: `isLogging` (boolean).
- [ ] Update `useMuse`:
    - Accept `preset` argument in `connect` or `start`.
    - Expose `rawPackets` observable from the client.
- [ ] Create `PacketLoggerView` component:
    - Dropdown for Preset.
    - Button to Start/Stop logging.
    - Button to Download.
        - Generate Blob from `logs`.
        - Create download link.

## 3. Integration
- [ ] Modify `App` render to switch between `EEGGraphView` and `PacketLoggerView` based on tab/button.
- [ ] Ensure `useMuse` correctly initializes the client with the selected preset when connecting/starting.
