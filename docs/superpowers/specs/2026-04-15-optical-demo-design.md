# OPTICAL graph in demo design

## Problem

The demo page currently visualizes EEG data only. Athena devices already expose OPTICAL readings, but the demo does not surface them. The goal is to add an OPTICAL graph to the demo while keeping it clearly separate from EEG and avoiding unnecessary memory growth.

## Proposed approach

Keep the existing `Graph` tab and add a second, OPTICAL-only panel below the EEG panel. The two panels are visible at the same time, but they use separate display state, channel toggles, and axis controls. OPTICAL visualization is shown only in Athena mode.

This stays intentionally scoped to the demo UI:

- add live OPTICAL visualization for Athena
- keep EEG and OPTICAL display state separate
- do not add OPTICAL recording or persistence
- do not add Muse Classic PPG support in this change

## Architecture

### Data sources

`useMuse` continues to manage connection lifecycle and device subscriptions. For Athena mode, it will also subscribe to `client.opticalReadings` in addition to EEG, battery, and accelerometer streams.

The hook will expose separate graph-ready state for:

- EEG display data
- OPTICAL display data

These datasets are independent so that EEG filtering and EEG axis changes do not affect OPTICAL rendering.

### UI structure

Within `demo\src\App.tsx`, the Graph view keeps its current order:

1. filter controls
2. recorder controls
3. EEG panel
4. new OPTICAL panel

The OPTICAL panel appears only when:

- `currentView === 'graph'`
- `mode === 'athena'`

If Athena is connected but no OPTICAL samples have arrived yet, the panel shows the same empty-state style as EEG.

## Components

### Shared chart behavior

Reuse the existing chart style as much as possible so the demo remains visually consistent:

- glass panel container
- `ResponsiveContainer` + `LineChart`
- legend
- zero/reference line only if it still makes sense for the chosen optical scale

The OPTICAL graph may reuse the current graph component with more generic props, or introduce a small wrapper component if that keeps the code clearer. The preferred direction is a small reuse-oriented refactor rather than duplicating the whole EEG graph.

### OPTICAL controls

The new panel includes:

- per-channel visibility toggles
- a dedicated Y-axis range control for OPTICAL only

It does not reuse EEG filter controls because those are EEG-specific.

## Data flow and memory behavior

OPTICAL display data should be derived from `opticalReadings` into a short, fixed-size display buffer intended only for rendering. The implementation should keep only recent points needed for the live graph window, rather than accumulating all received samples.

This means memory use grows by a small constant amount for one additional live graph rather than increasing over session length. No IndexedDB writes or recording buffers are added for OPTICAL in this scope.

## Channel naming

OPTICAL labels should use existing Athena naming where possible. If the incoming stream structure maps more naturally to grouped optical channels than to EEG-style electrodes, the UI should label them according to the current Athena optical naming exported by the library rather than inventing new demo-only names.

## Error handling and fallbacks

- If the device is not in Athena mode, no OPTICAL panel is shown.
- If the OPTICAL stream is unavailable or temporarily empty, the panel remains mounted only when Athena mode is active and shows a no-data state instead of throwing or hiding unexpectedly.
- Disconnecting clears both EEG and OPTICAL display buffers.

## Testing

Validation for this change should cover:

- demo builds successfully
- existing test suite still passes
- Graph view still renders EEG for both supported modes
- Athena Graph view renders a separate OPTICAL panel without affecting EEG behavior
- switching mode or disconnecting clears OPTICAL data cleanly

## Out of scope

- OPTICAL recording/export
- IndexedDB schema changes
- Muse Classic PPG visualization
- new top-level tabs or routing changes for OPTICAL
