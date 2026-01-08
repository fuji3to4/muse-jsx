# Task: Athena Packet Logger and Preset Selection

## User Request
- Create a Packet Logger feature for Athena (separate from the graph visualization).
- Allow downloading the captured packet logs.
- Allow selecting the Preset (currently fixed to `p1045` in `muse-athena.ts`) from the UI.

## Current State
- `muse-athena.ts` has `ATHENA_COMMANDS` but it is internal.
- `MuseAthenaClient` logs raw packets to console but doesn't expose them structurally for application-level logging/download.
- `start()` method in `MuseAthenaClient` accepts a preset argument, but the demo app doesn't make use of it (defaults to `p1045`).

## Proposed Solution
1.  **Backend (`muse-athena.ts`)**:
    - Expose `ATHENA_PRESETS` list.
    - Add a `rawPackets` Observable to `MuseAthenaClient` to stream raw packet data (timestamp, UUID, hex string) to the consumer.
2.  **Frontend (`demo/src/App.tsx`)**:
    - Add a "View" switcher: "EEG Graph" vs "Packet Logger".
    - **Packet Logger View**:
        - Preset Selector (Dropdown).
        - Connect/Start buttons (using selected preset).
        - "Start Logging" / "Stop Logging" buttons (controls whether to buffer packets).
        - "Download Logs" button (saves buffered logs to a text file).
        - Display count of captured packets.
    - Update `useMuse` hook to support passing the selected preset to the `start` sequence.
