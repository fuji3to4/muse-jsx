# Walkthrough: Muse-JSX Recharts Integration

## Changes
1. **Dependencies**: Added `react`, `react-dom`, `recharts`, `@vitejs/plugin-react`.
2. **Configuration**:
    - Updated `vite.config.mjs` to include React plugin.
    - Created `demo/tsconfig.json` and `demo/tsconfig.node.json` for proper React Typescript support.
3. **Application Structure**:
    - Replaced `demo/index.html` body with a React root.
    - Created `demo/src/main.tsx` as the entry point.
    - Created `demo/src/App.tsx` as the main component.
4. **Features Implemented in `App.tsx`**:
    - **Recharts Integration**: Using `LineChart` and `ResponsiveContainer` to display EEG data.
    - **Real-time Data**: Buffering EEG samples in a circular buffer (500 samples ~2 seconds window approx, logic adjusted for smooth rendering).
    - **Connection Handling**: `useMuse` hook manages `MuseClient` and `MuseAthenaClient` connection, supporting both devices.
    - **Channel Selection**: Checkboxes to toggle visibility of 8 channels (or 4/5 for Muse).
    - **Data Filtering**: Toggle between Raw and Filtered (Notch 60Hz) data.
    - **Hardware Stats**: Battery and Accelerometer data display.

## Verification
- Run `npm start` (which runs `vite`) to view the demo.
- Select "Athena" or "Muse" mode.
- Connect to a device.
- Verify graph updates and controls work.
