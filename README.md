# muse-jsx

JavaScript Library for Muse 1, Muse 2, and Muse S EEG Headsets (using Web Bluetooth).

**Demo Page:** <https://fuji3to4.github.io/muse-jsx/>

## About this

This repository is a derivative of the original [muse-js](https://github.com/urish/muse-js), modified via AI agent–assisted edits.

- **Original:** <https://github.com/urish/muse-js>
- **License:** See the included `LICENSE` (original attributions preserved).
- **Improvements:**
  - Node.js 20+ compatibility fixes
  - RxJS 7+ support
  - 🧪 **Experimental Support for Muse S (Athena Model)** - newer Muse S units using the Athena protocol

## Installation

**Option 1: Install from GitHub (Recommended for latest version)**

```bash
npm install git+https://github.com/fuji3to4/muse-jsx.git
```

> **Note:** This installation method should be tested separately in your project before production use.

**Option 2: Clone and link locally**

```bash
git clone https://github.com/fuji3to4/muse-jsx.git
cd muse-jsx
npm install
npm link
```

Then in your project:

```bash
npm link muse-jsx
```

## Requirements

- Node.js 18+ (recommended: 20+). TextEncoder/TextDecoder are available natively; no polyfills needed.
- Browser: Web Bluetooth capable (Chrome/Edge). A secure context (HTTPS or localhost) is required.

## Running the Demo App

```bash
npm install
npm start
```

Then open <http://localhost:4445/>

## Usage - Classic MuseClient

For **Muse 1, Muse 2, and original Muse S** devices, use the classic `MuseClient`:

```typescript
import { MuseClient } from 'muse-jsx';

async function main() {
  const client = new MuseClient();
  await client.connect();
  await client.start();
  
  client.eegReadings.subscribe(reading => {
    console.log(reading);
  });
  
  client.telemetryData.subscribe(telemetry => {
    console.log(telemetry);
  });
  
  client.accelerometerData.subscribe(acceleration => {
    console.log(acceleration);
  });
}

main();
```

### Auxiliary Electrode (Classic)

The Muse 2016 EEG headsets contain four electrodes, and you can connect an additional Auxiliary electrode through the Micro USB port. By default, data from the Auxiliary electrode channel is not read. Enable it by setting the `enableAux` property to `true` before calling the `connect` method:

```typescript
async function main() {
  const client = new MuseClient();
  client.enableAux = true;
  await client.connect();
}
```

In the demo app, AUX is off by default and can be enabled via the checkbox.

### PPG / Optical Sensor (Classic)

The Muse 2 and Muse S contain PPG/optical blood sensors. There are three signal streams: ppg1, ppg2, and ppg3. These are ambient, infrared, and red (respectively) on the Muse 2, and (we think, unconfirmed) infrared, green, and unknown (respectively) on the Muse S. 

To enable PPG before connecting:

```typescript
async function main() {
  const client = new MuseClient();
  client.enablePpg = true;
  await client.connect();
}
```

To subscribe to PPG readings:

```typescript
client.ppgReadings.subscribe((ppgreading) => {
  console.log(ppgreading);
});
```

> **Note:** PPG is not present on Muse 1/1.5, and enabling it may have unexpected consequences.

### Event Markers (Classic)

The `MuseClient` includes an `eventMarkers` stream for introducing timestamped event markers:

```typescript
async function main() {
  const client = new MuseClient();
  client.eventMarkers.subscribe((event) => {
    console.log(event);
  });
  
  client.injectMarker("house");
  client.injectMarker("face");
  client.injectMarker("dog");
}
```

## Usage - Muse S (Athena Model) 🧪 Experimental

For **newer Muse S units using the Athena protocol**, use the `MuseAthenaClient`:

> **⚠️ Important:** The original Muse S works with the classic `MuseClient`. This "Athena" client is specifically for newer Muse S units using the Athena protocol, which is incompatible with the classic logic.

### Basic Usage

```typescript
import { MuseAthenaClient } from 'muse-jsx';

async function main() {
  const client = new MuseAthenaClient();
  await client.connect();
  await client.start('p1045'); // Start with a specific preset
  
  client.athenaEegReadings.subscribe(reading => {
    console.log(reading.samples); // 8 channels, 256Hz
  });
}

main();
```

### Supported Features (Beta)

- Real-time EEG (8 channels, 256Hz)
- Accelerometer & Gyroscope (IMU)
- PPG / Optical Sensors
- Battery Status
- **Preset Selection** (e.g., `p1045`, `p21`) and **Packet Logging**

### Additional Resources

For detailed instructions and migration tips, please refer to:

- [ATHENA_IMPLEMENTATION_SUMMARY.md](docs/ATHENA_IMPLEMENTATION_SUMMARY.md)
- [ATHENA_SUPPORT.md](docs/ATHENA_SUPPORT.md)
- [MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md)

## Building and Deployment

### Local Build

To preview the deployable assets locally:

```bash
npm run build
npm run build:demo
```

Output directory: `dist-demo/`

### GitHub Pages

This repository includes a GitHub Pages workflow (`.github/workflows/pages.yml`). Pushing to `main` builds the `demo/` with Vite and deploys `dist-demo/` to Pages.

- Public URL: <https://fuji3to4.github.io/muse-jsx/>
- Vite `base` is set to `/muse-jsx/` so assets resolve correctly.

## Using in Node.js

This fork does not include or document Node.js support via bleat/noble. It targets Web Bluetooth in supported browsers. If you need Node.js integration, please refer to the original project and its ecosystem.

## References

- [urish/muse-js](https://github.com/urish/muse-js) - Original muse-js library
- [AbosaSzakal/MuseAthenaDataformatParser](https://github.com/AbosaSzakal/MuseAthenaDataformatParser) - Muse Athena data format parser
- [Amused-EEG/amused-py](https://github.com/Amused-EEG/amused-py) - Python tools for Muse EEG devices
- [DominiqueMakowski/OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) - Open-source Muse project

## License

MIT License
