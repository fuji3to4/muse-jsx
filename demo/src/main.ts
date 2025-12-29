// tslint:disable:no-console

import { MuseClient, channelNames, zipSamples } from '../../src/muse';
import type { EEGReading } from '../../src/muse';
import { notchFilter, epoch } from '@neurosity/pipes';
import { tap } from 'rxjs';

let client: MuseClient | null = null;

async function connect() {
    const graphTitles = Array.from(document.querySelectorAll('.electrode-item h3'));
    const canvases = Array.from(document.querySelectorAll('.electrode-item canvas')) as HTMLCanvasElement[];
    const canvasCtx = canvases.map((canvas) => canvas.getContext('2d'));

    graphTitles.forEach((item, index) => {
        item.textContent = channelNames[index];
    });

    function plot(reading: EEGReading) {
        const canvas = canvases[reading.electrode];
        const context = canvasCtx[reading.electrode];
        if (!context) {
            return;
        }
        const width = canvas.width / 12.0;
        const height = canvas.height / 2.0;
        context.fillStyle = 'green';
        context.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < reading.samples.length; i++) {
            const sample = reading.samples[i] / 15;
            if (sample > 0) {
                context.fillRect(i * 25, height - sample, width, sample);
            } else {
                context.fillRect(i * 25, height, width, -sample);
            }
        }
    }

    client = new MuseClient();
    client.connectionStatus.subscribe((status) => {
        console.log(status ? 'Connected!' : 'Disconnected');
        updateButtonStates(status);
    });

    try {
        // AUX の有効/無効は UI のチェックボックスで切り替え（既定は無効）
        const auxToggle = document.getElementById('aux-toggle') as HTMLInputElement | null;
        client.enableAux = !!auxToggle?.checked;
        await client.connect();

        // Subscribe to EEG BEFORE start to avoid missing data
        const nbChannels = client.enableAux ? 5 : 4;
        client.eegReadings
            .pipe(
                tap((reading) => {
                    console.log('Raw EEG', reading);
                    plot(reading);
                }),
                zipSamples,
                notchFilter({ nbChannels, cutoffFrequency: 60 }),
                tap((sample) => {
                    console.log('Filtered EEG', sample);
                }),
                epoch({ duration: 256, interval: 25 }),
            )
            .subscribe((ep) => {
                console.log('epoch', ep);
            });

        await client.start();
        document.getElementById('headset-name')!.innerText = client.deviceName ?? 'unknown';
        client.telemetryData.subscribe((reading) => {
            document.getElementById('temperature')!.innerText = reading.temperature.toString() + '℃';
            document.getElementById('batteryLevel')!.innerText = reading.batteryLevel.toFixed(2) + '%';
        });
        client.accelerometerData.subscribe((accel) => {
            const normalize = (v: number) => (v / 16384).toFixed(2) + 'g';
            document.getElementById('accelerometer-x')!.innerText = normalize(accel.samples[2].x);
            document.getElementById('accelerometer-y')!.innerText = normalize(accel.samples[2].y);
            document.getElementById('accelerometer-z')!.innerText = normalize(accel.samples[2].z);
        });
        await client.deviceInfo().then((deviceInfo) => {
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

// ページ読み込み後にボタンにイベントリスナーを追加
function initUI() {
    const connectButton = document.getElementById('connect-button');
    const disconnectButton = document.getElementById('disconnect-button');
    if (connectButton) {
        (connectButton as HTMLButtonElement).addEventListener('click', connect);
    }
    if (disconnectButton) {
        (disconnectButton as HTMLButtonElement).addEventListener('click', disconnect);
    }
    updateButtonStates(false);
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}
