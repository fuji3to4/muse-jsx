# Task: Integrate Recharts for EEG Visualization in Muse-JSX Demo

## User Request
- Change the demo page to use Recharts for EEG graphing.
- Support `rawdata` and `filtereddata`.
- Implement a time-series graph where data flows (new data added to the end).
- Support 8 electrodes with visibility toggles.

## Current State
- The demo is a vanilla TypeScript application bundled with Vite.
- Entry point is `demo/index.html` loading `demo/src/loader.ts`.
- `loader.ts` dynamically imports `main.ts` (Muse) or `main_athena.ts` (Athena).
- Visualization is done via direct HTML5 Canvas manipulation.

## Proposed Solution
- Migrate the demo application to React to leverage Recharts.
- Create a `useMuse` hook to manage the `MuseClient` / `MuseAthenaClient` connection and data streams.
- Implement a `EEGChart` component using Recharts `<LineChart>`.
- Allow toggling between Raw and Filtered data streams.
- Add checkboxes to toggle visibility of individual channels.
