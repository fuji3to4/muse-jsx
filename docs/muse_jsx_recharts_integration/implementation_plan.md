# Implementation Plan: Muse-JSX Recharts Integration

## 1. Setup Environment
- [ ] Add dependencies: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `recharts`, `@vitejs/plugin-react`.
- [ ] Update `vite.config.mjs` to include the React plugin.

## 2. React Migration
- [ ] Create `demo/src/main.tsx` as the new entry point.
- [ ] Update `demo/index.html` to contain a `#root` div and import `main.tsx`.
- [ ] Create `demo/src/App.tsx` to hold the main application layout.

## 3. Data Logic (Hooks)
- [ ] detailed `useMuse.ts` hook:
    - Manage `MuseClient` and `MuseAthenaClient` instances.
    - Handle connection/disconnection.
    - Subscribe to `eegReadings` (raw) and pipe through filters for `filtered` data.
    - Maintain a circular buffer (or state array) for graph data to avoid memory leaks and ensure performance.
    - Expose `connect`, `disconnect`, `status`, `battery`, `accelerometer`, and `eegData`.

## 4. UI Components
- [ ] `ControlPanel`: Connect buttons, Mode selector (Muse/Athena), Signal type selector (Raw/Filtered).
- [ ] `ChannelSelector`: Checkboxes for the 8 channels.
- [ ] `EEGChart`: Wrapper around Recharts `LineChart` / `ResponsiveContainer`.
    - Use `recharts` to map the data buffer.
    - Optimization: Ensure the component doesn't re-render 256 times a second. Use `requestAnimationFrame` style batching or throttle state updates.

## 5. Implementation Steps
- [ ] Install deps.
- [ ] Configure Vite.
- [ ] Scaffold React structure.
- [ ] Port connection logic from `main_athena.ts` / `main.ts` to `useMuse`.
- [ ] Implement the Graph.
- [ ] Verify functionality with mock data (if headset is not available) or just code correctness.

## 6. Verification
- [ ] Check if the graph scrolls.
- [ ] Check if channels can be toggled.
- [ ] Check if Raw/Filtered switching works.
