# Walkthrough: Athena Packet Logger

## Changes
1.  **Backend (`src/muse-athena.ts`)**:
    - Exposed `ATHENA_PRESETS` and `ATHENA_COMMANDS` (though commands are less critical for UI).
    - Added a `rawPackets` Subject to `MuseAthenaClient` that emits `{ timestamp, uuid, data }` for every packet received.
    - Updated `start(preset)` to use the provided preset (this was already there, but ensuring it's used).

2.  **Frontend (`demo/src/App.tsx`)**:
    - **Separate Views**: Implemented a top-bar navigation to switch between "EEG Graph" and "Athena Packet Logger".
    - **PacketLogger Component**:
        - Allows selecting an initialization preset (`p21`, `p1034`, `p1035`, `p1045`).
        - **Logging Controls**: "Start/Stop Logging" buttons to control data accumulation.
        - **Visualize Logs**: Shows a live-updating list of the last 50 packets (hex dump).
        - **Download**: Generates a CSV file (`timestamp,uuid,hex`) of all captured packets.
    - **App Component Integration**:
        - Passed `selectedPreset` state to `useMuse`.
        - Exposed `clientRef` from `useMuse` to let `PacketLogger` subscribe to `rawPackets`.
        - Managed state for `currentView`.

## Verification
- Run `npm start`.
- Select "Athena" mode.
- Go to "Athena Packet Logger" tab.
- Choose a preset (e.g. `p1045`).
- Click Connect.
- Click "Start Logging".
- See packets appearing in the list.
- Click "Download Logs" to get the CSV.
- Switch back to Graph view to see visualizations (if compatible with the selected preset).
