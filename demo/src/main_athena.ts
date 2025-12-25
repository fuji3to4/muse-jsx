// tslint:disable:no-console

import { channelNames } from '../../src/muse';
import { MuseAthenaClient } from '../../src/muse-athena';

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
    const client = new MuseAthenaClient();
    client.connectionStatus.subscribe((status) => {
        console.log(status ? 'Connected!' : 'Disconnected');
    });

    try {
        // AUX の有効/無効は UI のチェックボックスで切り替え（既定は無効）
        // const auxToggle = document.getElementById('aux-toggle') as HTMLInputElement | null;
        // client.enableAux = !!auxToggle?.checked;
        await client.connect();

        // Subscribe to streams BEFORE starting to ensure we don't miss any data
        client.eegReadings.subscribe((reading) => {
            console.log('EEG', reading);
            plot(reading);
        });

        client.batteryData.subscribe((reading) => {
            // Battery data format not yet reverse-engineered for Athena
            // Displaying raw 10x 16-bit values until protocol is documented
            console.log('Battery (raw values, interpretation unknown):', reading.values);

            // TODO: Add proper interpretation when battery format is documented
            // document.getElementById('batteryLevel')!.innerText = '??%';
        });
        client.accGyroReadings.subscribe((accel) => {
            console.log('Acc/Gyro', accel);
            // const normalize = (v: number) => (v / 16384).toFixed(2) + 'g';
            // document.getElementById('accelerometer-x')!.innerText = normalize(accel.samples[2].x);
            // document.getElementById('accelerometer-y')!.innerText = normalize(accel.samples[2].y);
            // document.getElementById('accelerometer-z')!.innerText = normalize(accel.samples[2].z);
        });

        await client.start();
        document.getElementById('headset-name')!.innerText = client.deviceName ?? 'unknown';

        await client.deviceInfo().then((deviceInfo) => {
            console.log('Device Info', deviceInfo);
            // document.getElementById('hardware-version')!.innerText = deviceInfo.hw;
            // document.getElementById('firmware-version')!.innerText = deviceInfo.fw;
        });
    } catch (err) {
        console.error('Connection failed', err);
    }
}

// ページ読み込み後にボタンにイベントリスナーを追加
document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.querySelector('button');
    if (connectButton) {
        connectButton.addEventListener('click', connect);
    }
    // Athena: 8 channels total, no AUX toggle (all channels are used)
    // This code is kept for compatibility but Athena always shows all 8 channels
    const auxToggle = document.getElementById('aux-toggle') as HTMLInputElement | null;
    const electrodeItems = Array.from(document.querySelectorAll('.electrode-item')) as HTMLElement[];
    const updateAuxVisibility = () => {
        // For Athena, show all 8 channels (no AUX toggle needed)
        electrodeItems.forEach((item, index) => {
            if (index < 8) {
                item.style.display = '';
            }
        });
    };
    updateAuxVisibility();
    if (auxToggle) {
        // Athena uses all 8 channels, so disable AUX toggle
        auxToggle.style.display = 'none';
    }
});
