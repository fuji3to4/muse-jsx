# muse-jsx

> Note (credit and provenance)
>
> This repository is a derivative of the original muse-js ([muse-js](https://github.com/urish/muse-js)), modified mainly via AI agent–assisted edits. All credit and copyright belong to the original authors and contributors of urish/muse-js. This repository does not claim originality. See the bundled LICENSE.


 Muse 1, Muse 2, and Muse S EEG Headset JavaScript Library (using Web Bluetooth).
 Reconstruct muse-js from source code.

## About this fork

- Original: <https://github.com/urish/muse-js>
- License: See the included `LICENSE` (original attributions preserved).
- Node.js 20+ compatibility fixes.
- RxJS 7+ support.

## Requirements

- Node.js 18+ (recommended: 20+). TextEncoder/TextDecoder are available natively; no polyfills needed.
- Browser: Web Bluetooth capable (Chrome/Edge). A secure context (HTTPS or localhost) is required.

## Running the demo app

    npm install
    npm start

and then open <http://localhost:4445/>

## Usage example

    import { MuseClient } from 'muse-js';

    async function main() {
      let client = new MuseClient();
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

## Host the demo on GitHub Pages

This repository includes a GitHub Pages workflow (`.github/workflows/pages.yml`). Pushing to `main` builds the `demo/` with Vite and deploys `dist-demo/` to Pages.

- Public URL (depends on your account/repo): `https://<your-account>.github.io/muse-jsx/`
- Vite `base` is set to `/muse-jsx/` so assets resolve correctly.

To preview the deployable assets locally:

  npm run build
  npm run build:demo

Output directory: `dist-demo/`

## Using in Node.js

This fork does not include or document Node.js support via bleat/noble. It targets Web Bluetooth in supported browsers. If you need Node.js integration, please refer to the original project and its ecosystem.

## Auxiliary Electrode

The Muse 2016 EEG headsets contain four electrodes, and you can connect an additional Auxiliary electrode through the Micro USB port. By default, muse-js does not read data from the Auxiliary electrode channel. You can change this behavior and enable the Auxiliary electrode by setting the `enableAux` property to `true`, just before calling the `connect` method:

    async function main() {
      let client = new MuseClient();
      client.enableAux = true;
      await client.connect();
    }

In the demo app, AUX is off by default and can be enabled via the checkbox.

## PPG (Photoplethysmography) / Optical Sensor

The Muse 2 and Muse S contain PPG/optical blood sensors, which this library supports. There are three signal streams, ppg1, ppg2, and ppg3. These are ambient, infrared, and red (respectively) on the Muse 2, and (we think, unconfirmed) infrared, green, and unknown (respectively) on the Muse S. To use PPG, ensure you enable it before connecting to a Muse. PPG is not present and thus will not work on Muse 1/1.5, and enabling it may have unexpected consequences.

To enable PPG:

    async function main() {
      let client = new MuseClient();
      client.enablePpg = true;
      await client.connect();
    }

To subscribe and receive values from PPG, it's just like subscribing to EEG (see "Usage example"):

    client.ppgReadings.subscribe((ppgreading) => {
        console.log(ppgreading);
    });

## Event Markers

For convenience, there is an `eventMarkers` stream included in `MuseClient` that you can use in order to introduce timestamped event markers into your project. Just subscribe to `eventMarkers` and use the `injectMarker` method with the value and optional timestamp of an event to send it through the stream.

    async function main() {
      let client = new MuseClient();
      client.eventMarkers.subscribe((event) => {
        console.log(event);
      });
      client.injectMarker("house")
      client.injectMarker("face")
      client.injectMarker("dog")
    }


## License

MIT License
