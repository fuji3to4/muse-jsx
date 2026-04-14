# Demo EEG graph memory stabilization design

## Problem

The demo app can run out of memory and crash the browser when EEG measurement and graph rendering continue for a long time. The fix must keep Recorder and Logger behavior intact, including IndexedDB-backed persistence, while making graph rendering memory usage stable over time.

## Goals

- Prevent unbounded memory growth in graph view during long-running EEG sessions.
- Preserve existing Recorder and Athena Logger data capture behavior.
- Keep the graph responsive enough for real-time monitoring.
- Clean up all graph-related resources on disconnect, mode change, and view change.

## Non-goals

- Replacing Recharts with a different rendering stack.
- Reducing Recorder or Logger retention, fidelity, or storage behavior.
- Changing EEG filtering behavior outside what is needed for stable graph rendering.

## Recommended approach

Use a fixed-length ring buffer for graph display data and decouple sample ingestion from React rendering.

### Why this approach

This keeps the demo change local to the graph pipeline, prevents display data from growing without bound, and reduces render churn. It addresses the out-of-memory issue without forcing broader UI or storage changes.

## Design

### 1. Split the graph pipeline into ingestion and rendering

Inside `useMuse`, keep the filtered EEG stream as the source of truth for graph display, but stop sending every epoched emission directly into React state.

- **Ingestion step:** subscribe to the graph stream and append samples into a fixed-length ring buffer.
- **Rendering step:** on a timed cadence, snapshot the current ring buffer into a small array and call `setData`.

This separates high-frequency EEG arrival from lower-frequency chart updates.

### 2. Bound the graph memory footprint

The graph should only retain a recent display window, not the full session history.

- **Display window:** retain approximately the most recent 5 seconds of data.
- **Sampling assumption:** 256 Hz.
- **Buffer size:** cap stored graph points to the amount needed for that window.

When new points arrive after the cap is reached, overwrite the oldest points instead of extending the array.

### 3. Throttle chart updates

Update the React state used by `Recharts` on a fixed cadence rather than on every graph stream emission.

- **Render cadence:** every 100 ms.
- Each render tick should publish only the latest bounded snapshot from the ring buffer.

This stabilizes both CPU and GC pressure and prevents React/Recharts from constantly receiving newly allocated full-window arrays at stream rate.

### 4. Preserve storage and logging behavior

The Recorder and Athena Logger paths stay unchanged.

- Recorder continues consuming the EEG stream for IndexedDB persistence.
- Athena Logger continues consuming its packet stream independently.
- The graph memory fix applies only to the graph display path.

### 5. Cleanup and lifecycle rules

On disconnect, status change, mode change, or graph/view teardown:

- unsubscribe from graph ingestion
- stop any render timer/subscription used for chart refresh
- clear the ring buffer
- clear `data` state

This avoids stale subscriptions and retained buffers after view transitions.

## Error handling

- Keep existing graph stream error logging behavior.
- Do not silently swallow graph pipeline errors.
- If the graph stream stops because of an upstream error, release graph resources during cleanup as normal.

## Testing and verification

### Functional checks

1. Connect in graph view and confirm the chart continues updating in real time.
2. Run a long session and confirm browser memory usage does not continue rising with elapsed time.
3. Switch between graph, logger, and recording views and confirm no stale graph data is retained.
4. Disconnect and reconnect and confirm the graph resets cleanly.
5. Confirm Recorder and Logger behavior remains unchanged.

### Implementation checks

1. The chart state never exceeds the configured fixed display window.
2. There is exactly one active graph ingestion subscription and one active render cadence at a time.
3. Cleanup runs for all dependency changes currently handled by the graph effect.

## Alternatives considered

### A. Keep only `data.slice(-N)` in React state

This is the smallest code change, but it still reallocates arrays and objects frequently and leaves avoidable pressure on React and Recharts during long runs.

### B. Replace Recharts with Canvas/WebGL

This would likely provide the strongest rendering performance ceiling, but it is a much larger change than needed for the current problem.

## Open decisions resolved

- Use a bounded recent-history graph instead of full-session graph retention.
- Preserve IndexedDB-backed recording behavior.
- Start with a 5-second graph window and 100 ms render cadence.

## Expected outcome

The demo graph becomes time-bounded and memory-stable, so long-running EEG sessions no longer crash the browser due to graph display growth.
