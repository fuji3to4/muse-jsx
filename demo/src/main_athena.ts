// tslint:disable:no-console

import Stream from 'stream';
import { zipSamples } from '../../src/muse';
import { channelNames, MuseAthenaClient } from '../../src/muse-athena';
import { bandpassFilter, highpassFilter, lowpassFilter, notchFilter, epoch, fft, powerByBand } from '@neurosity/pipes';
import { map, tap } from 'rxjs';

let client: MuseAthenaClient | null = null;

async function connect() {
    const graphTitles = Array.from(document.querySelectorAll('.electrode-item h3'));
    const canvases = Array.from(document.querySelectorAll('.electrode-item canvas')) as HTMLCanvasElement[];
    const canvasCtx = canvases.map((canvas) => canvas.getContext('2d'));

    graphTitles.forEach((item, index) => {
        item.textContent = channelNames[index];
    });

    // Accept AthenaEEGReading and map to EEGReading shape for plotting
    function plot(reading: { electrode?: number; channel?: number; samples?: number[] }) {
        // AthenaEEGReading has 'electrode' and 'samples' (2 per packet for Athena)
        const electrode = reading.electrode ?? reading.channel;
        const samples = reading.samples ?? [];
        if (typeof electrode !== 'number' || electrode < 0 || electrode >= canvases.length) {
            return;
        }
        const canvas = canvases[electrode];
        const context = canvasCtx[electrode];
        if (!context) {
            return;
        }
        // Athena: 2 samples per packet at 256 Hz (vs 12 for standard Muse)
        const samplesPerPacket = samples.length;
        const width = canvas.width / samplesPerPacket;
        const height = canvas.height / 2.0;
        context.fillStyle = 'green';
        context.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i] / 15;
            if (sample > 0) {
                context.fillRect(i * width, height - sample, width, sample);
            } else {
                context.fillRect(i * width, height, width, -sample);
            }
        }
    }

    // const client = new MuseClient();
    client = new MuseAthenaClient();
    client.connectionStatus.subscribe((status) => {
        console.log(status ? 'Connected!' : 'Disconnected');
        updateButtonStates(status);
    });

    try {
        await client.connect();

        // Subscribe to streams BEFORE starting to ensure we don't miss any data
        client.eegReadings
            .pipe(
                tap((reading) => {
                    console.log('Raw EEG', reading);
                    plot(reading);
                }),
                zipSamples,
                notchFilter({ nbChannels: 8, cutoffFrequency: 60 }),
                tap((sampleWithInfo) => {
                    console.log('Filtered EEG', sampleWithInfo);
                }),
                epoch({ duration: 256, interval: 25, samplingRate: 256 }),
            )
            .subscribe((reading) => {
                console.log('epoch', reading);
                // plot(reading);
            });

        client.batteryData.subscribe((reading) => {
            // Battery data format not yet reverse-engineered for Athena
            // Displaying raw 10x 16-bit values until protocol is documented
            // console.log('Battery (raw values, interpretation unknown):', reading.values);

            // TODO: Add proper interpretation when battery format is documented
            document.getElementById('batteryLevel')!.innerText = String(reading.values[0] ?? '') + '%';
        });
        client.accGyroReadings.subscribe((accel) => {
            // console.log('Acc/Gyro', accel);
            // const normalize = (v: number) => (v / 16384).toFixed(2) + 'g';
            document.getElementById('accelerometer-x')!.innerText = String(accel.acc?.x ?? '');
            document.getElementById('accelerometer-y')!.innerText = String(accel.acc?.y ?? '');
            document.getElementById('accelerometer-z')!.innerText = String(accel.acc?.z ?? '');
        });

        await client.start();
        document.getElementById('headset-name')!.innerText = client.deviceName ?? 'unknown';

        await client.deviceInfo().then((deviceInfo) => {
            console.log('Device Info', deviceInfo);
            document.getElementById('hardware-version')!.innerText = deviceInfo.hw;
            document.getElementById('firmware-version')!.innerText = deviceInfo.fw;
        });
    } catch (err) {
        console.error('Connection failed', err);
    }
}

async function disconnect() {
    if (client) {
        await client.disconnect();
        client = null;
        console.log('Disconnected');
    }
}

function updateButtonStates(connected: boolean) {
    const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
    const disconnectButton = document.getElementById('disconnect-button') as HTMLButtonElement;
    if (connectButton) connectButton.disabled = connected;
    if (disconnectButton) disconnectButton.disabled = !connected;
}

function initUI() {
    const connectButton = document.getElementById('connect-button');
    const disconnectButton = document.getElementById('disconnect-button');
    if (connectButton) {
        connectButton.addEventListener('click', connect);
    }
    if (disconnectButton) {
        disconnectButton.addEventListener('click', disconnect);
    }
    updateButtonStates(false);
    // Athena: 8 channels total, no AUX toggle (all channels are used)
    // This code is kept for compatibility but Athena always shows all 8 channels
    // const auxToggle = document.getElementById('aux-toggle') as HTMLInputElement | null;
    // const electrodeItems = Array.from(document.querySelectorAll('.electrode-item')) as HTMLElement[];
    // const updateAuxVisibility = () => {
    //     electrodeItems.forEach((item, index) => {
    //         if (index < 8) {
    //             item.style.display = '';
    //         }
    //     });
    // };
    // updateAuxVisibility();
    // if (auxToggle) {
    //     auxToggle.style.display = 'none';
    // }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}
