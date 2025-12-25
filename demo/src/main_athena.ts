// tslint:disable:no-console

import { channelNames } from '../../src/muse';
import { MuseAthenaClient } from '../../src/muse_athena';

async function connect() {
    const graphTitles = Array.from(document.querySelectorAll('.electrode-item h3'));
    const canvases = Array.from(document.querySelectorAll('.electrode-item canvas')) as HTMLCanvasElement[];
    const canvasCtx = canvases.map((canvas) => canvas.getContext('2d'));

    graphTitles.forEach((item, index) => {
        item.textContent = channelNames[index];
    });

    // Accept AthenaEEGReading and map to EEGReading shape for plotting
    function plot(reading: { electrode?: number; channel?: number; samples?: number[] }) {
        // AthenaEEGReading does not have 'electrode', but has 'channel'
        const electrode = reading.electrode ?? reading.channel;
        const samples = reading.samples ?? [];
        const canvas = canvases[electrode];
        const context = canvasCtx[electrode];
        if (!context) {
            return;
        }
        const width = canvas.width / 12.0;
        const height = canvas.height / 2.0;
        context.fillStyle = 'green';
        context.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i] / 15;
            if (sample > 0) {
                context.fillRect(i * 25, height - sample, width, sample);
            } else {
                context.fillRect(i * 25, height, width, -sample);
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
        client.athenaEegReadings.subscribe((reading) => {
            console.log('EEG', reading);
            plot(reading);
        });
        client.athenaBatteryData.subscribe((reading) => {
            console.log('Battery', reading);
            // document.getElementById('temperature')!.innerText = reading.temperature.toString() + '℃';
            // document.getElementById('batteryLevel')!.innerText = (reading.level ?? 0).toFixed(2) + '%';
        });
        client.athenaAccGyroReadings.subscribe((accel) => {
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
    // AUX 未使用時は AUX 用 UI を隠す
    const auxToggle = document.getElementById('aux-toggle') as HTMLInputElement | null;
    const electrodeItems = Array.from(document.querySelectorAll('.electrode-item')) as HTMLElement[];
    const updateAuxVisibility = () => {
        const showAux = !!auxToggle?.checked;
        const auxItem = electrodeItems[4]; // 5番目が AUX
        if (auxItem) auxItem.style.display = showAux ? '' : 'none';
    };
    if (auxToggle) {
        auxToggle.addEventListener('change', updateAuxVisibility);
        updateAuxVisibility();
    }
});
