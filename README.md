# muse-js

> Note (credit and provenance)
>
> This repository is a minimal derivative of the original muse-js ([muse-js](https://github.com/urish/muse-js)), modified only via AI agent–assisted edits. All credit and copyright belong to the original authors and contributors of urish/muse-js. This repository does not claim originality. See the bundled LICENSE.


 Muse 1, Muse 2, and Muse S EEG Headset JavaScript Library (using Web Bluetooth).
 Reconstruct muse-js from source code.

## About changes

- Changes in this repository are intentionally minimal. Please see the commit history for details.
- Original: <https://github.com/urish/muse-js>
- License: See the included `LICENSE` (original attributions preserved).

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

## Using in Node.js

This fork does not include or document Node.js support via bleat/noble. It targets Web Bluetooth in supported browsers. If you need Node.js integration, please refer to the original project and its ecosystem.

## Auxiliary Electrode

The Muse 2016 EEG headsets contains four electrodes, and you can connect an additional Auxiliary electrode through the Micro USB port. By default, muse-js does not read data from the Auxiliary electrode channel. You can change this behavior and enable the Auxiliary electrode by setting the `enableAux` property to `true`, just before calling the `connect` method:

    async function main() {
      let client = new MuseClient();
      client.enableAux = true;
      await client.connect();
    }

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

