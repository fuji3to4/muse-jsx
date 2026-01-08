import React, { useState, useEffect } from 'react';
import { LineChart, Line, YAxis, Legend, ResponsiveContainer } from 'recharts';
import { MuseClient, channelNames as museChannelNames, zipSamples } from '../../src/muse';
import { MuseAthenaClient, channelNames as athenaChannelNames } from '../../src/muse-athena';
import { notchFilter } from '@neurosity/pipes';
import { tap } from 'rxjs';

// --- Types ---

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type Reading = {
    index: number;
    timestamp: number;
    [key: string]: number; // ch0, ch1, ...
};

// --- Hook for Muse Logic ---

function useMuse(mode: 'muse' | 'athena', enableAux: boolean) {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [battery, setBattery] = useState<string>('unknown');
    const [accelerometer, setAccelerometer] = useState({ x: 0, y: 0, z: 0 });
    const [deviceInfo, setDeviceInfo] = useState({ hw: 'unknown', fw: 'unknown', name: 'unknown' });
    const [data, setData] = useState<Reading[]>([]);
    const [filterEnabled, setFilterEnabled] = useState(false);

    // We keep a mutable buffer to avoid excessive state updates for every sample
    // But for React to render, we need to update state eventually.
    // We'll update state at a lower rate (e.g. 30fps)
    const dataBufferRef = React.useRef<Reading[]>([]);
    const clientRef = React.useRef<MuseClient | MuseAthenaClient | null>(null);

    useEffect(() => {
        let animationFrameId: number;
        let lastUpdateTime = 0;

        const updateLoop = (timestamp: number) => {
            if (timestamp - lastUpdateTime > 50) { // Update every 50ms (~20fps)
                if (dataBufferRef.current.length > 0) {
                    // Keep last 500 points
                    if (dataBufferRef.current.length > 500) {
                        dataBufferRef.current = dataBufferRef.current.slice(dataBufferRef.current.length - 500);
                    }
                    setData([...dataBufferRef.current]);
                }
                lastUpdateTime = timestamp;
            }
            animationFrameId = requestAnimationFrame(updateLoop);
        };
        animationFrameId = requestAnimationFrame(updateLoop);

        return () => cancelAnimationFrame(animationFrameId);
    }, []);

    const connect = async () => {
        if (status === 'connected' || status === 'connecting') return;

        try {
            setStatus('connecting');
            const client = mode === 'athena' ? new MuseAthenaClient() : new MuseClient();
            clientRef.current = client;

            if (mode === 'muse' && client instanceof MuseClient) {
                client.enableAux = enableAux;
            }

            await client.connect();
            setStatus('connected');

            setDeviceInfo({
                hw: 'loading...',
                fw: 'loading...',
                name: client.deviceName || 'unknown'
            });

            client.deviceInfo().then(info => {
                setDeviceInfo({ hw: info.hw, fw: info.fw, name: client.deviceName || 'unknown' });
            });

            if (client instanceof MuseClient) { // Muse
                client.telemetryData.subscribe(t => {
                    setBattery(t.batteryLevel.toFixed(2) + '%');
                });
                client.accelerometerData.subscribe(accel => {
                    setAccelerometer({ x: accel.samples[2].x, y: accel.samples[2].y, z: accel.samples[2].z });
                });
            } else if (client instanceof MuseAthenaClient) { // Athena
                client.batteryData.subscribe(t => {
                    setBattery(String(t.values[0] || '?'));
                });
                client.accGyroReadings.subscribe(accel => {
                    setAccelerometer({ x: accel.acc?.x || 0, y: accel.acc?.y || 0, z: accel.acc?.z || 0 });
                });
            }

            // EEG Stream
            const nbChannels = mode === 'athena' ? 8 : (enableAux ? 5 : 4);

            // We need to handle raw vs filtered.
            // Currently simplest is to stream one or the other based on a toggle, but usually pipes are static.
            // We can subscribe to valid stream.

            // Let's create a stream that switches? No, difficult with pipes.
            // We'll process data and push to buffer.

            // Raw stream
            // Note: Athena 'eegReadings' gives { electrode, samples[] }. Muse gives { electrode, index, timestamp, samples[] }

            client.eegReadings.pipe(
                // For graph, we want to unify structure.
                // Muse: 12 samples per packet? No, usually 12 samples per packet means 256Hz / 20 = ~12.
                // Athena: 2 samples per packet.

                // We need a way to zip them into "Timeframes" where each frame has { ch0: val, ch1: val ... }
                // zipSamples utility from muse-js helps here for Muse.
                // Does it work for Athena?
                // Athena main_athena.ts uses zipSamples too.

                zipSamples,
                tap(sample => {
                    if (!filterEnabled) {
                        // Push raw sample
                        pushSample(sample);
                    }
                }),
                notchFilter({ nbChannels, cutoffFrequency: 60 }),
                tap(sample => {
                    if (filterEnabled) {
                        pushSample(sample);
                    }
                })
            ).subscribe();

            await client.start();

        } catch (e) {
            console.error(e);
            setStatus('disconnected');
        }
    };

    const disconnect = async () => {
        if (clientRef.current) {
            clientRef.current.disconnect();
            clientRef.current = null;
        }
        setStatus('disconnected');
    };

    // Helper to push sample to buffer
    const pushSample = (sample: { data: number[], timestamp: number, index: number }) => {
        // sample.data is array of values [ch0, ch1, ...]
        const reading: Reading = {
            index: sample.index,
            timestamp: sample.timestamp,
        };
        sample.data.forEach((val, idx) => {
            reading[`ch${idx}`] = val;
        });

        dataBufferRef.current.push(reading);
    };

    // Clear buffer on filter switch to avoid jumps? Maybe not needed.
    useEffect(() => {
        // Clear buffer when switching connection or mode
        dataBufferRef.current = [];
        setData([]);
    }, [mode, status]);

    return { connect, disconnect, status, battery, accelerometer, deviceInfo, data, filterEnabled, setFilterEnabled };
}

// --- Components ---

const COLORS = ['#FF6633', '#FFB399', '#FF33FF', '#FFFF99', '#00B3E6', '#E6B333', '#3366E6', '#999966', '#99FF99', '#B34D4D'];

function EEGGraph({ data, visibleChannels }: { data: Reading[], visibleChannels: boolean[] }) {
    if (data.length === 0) return <div style={{ height: 400, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#666' }}>No Data</div>;

    // Calculate domain for Y axis dynamically or fixed? EEG usually -100 to 100 uV (filtered) or larger (raw).
    // Let's use auto for now.

    return (
        <div style={{ height: 500, width: '100%' }}>
            <ResponsiveContainer>
                <LineChart data={data}>
                    {/* <XAxis dataKey="index" type="number" domain={['dataMin', 'dataMax']} /> */}
                    <YAxis domain={['auto', 'auto']} />
                    {/* <Tooltip /> */}
                    <Legend />
                    {visibleChannels.map((visible, idx) => (
                        visible && (
                            <Line
                                key={idx}
                                type="monotone"
                                dataKey={`ch${idx}`}
                                stroke={COLORS[idx % COLORS.length]}
                                dot={false}
                                isAnimationActive={false} // Important for performance
                            />
                        )
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

export default function App() {
    const [mode, setMode] = useState<'muse' | 'athena'>('athena');
    const [enableAux, setEnableAux] = useState(false);
    const [visibleChannels, setVisibleChannels] = useState<boolean[]>(new Array(8).fill(true));

    const { connect, disconnect, status, battery, accelerometer, deviceInfo, data, filterEnabled, setFilterEnabled } = useMuse(mode, enableAux);

    // Update visible channels based on mode (Muse has 4/5, Athena has 8)
    useEffect(() => {
        if (mode === 'muse') {
            setVisibleChannels(prev => prev.map((_, i) => i < (enableAux ? 5 : 4)));
        } else {
            setVisibleChannels(new Array(8).fill(true));
        }
    }, [mode, enableAux]);

    const toggleChannel = (idx: number) => {
        setVisibleChannels(prev => {
            const next = [...prev];
            next[idx] = !next[idx];
            return next;
        });
    };

    const currentChannelNames = mode === 'athena' ? athenaChannelNames : museChannelNames;

    return (
        <div style={{ padding: 20, fontFamily: 'sans-serif', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
            <h1>Muse JSX Recharts Demo</h1>

            <div style={{ padding: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={mode} onChange={e => setMode(e.target.value as any)} disabled={status === 'connected'}>
                    <option value="athena">Athena</option>
                    <option value="muse">Muse (Classic)</option>
                </select>

                {mode === 'muse' && (
                    <label>
                        <input type="checkbox" checked={enableAux} onChange={e => setEnableAux(e.target.checked)} disabled={status === 'connected'} />
                        Enable Aux
                    </label>
                )}

                <button onClick={status === 'connected' ? disconnect : connect}>
                    {status === 'connected' ? 'Disconnect' : 'Connect'}
                </button>

                <span>Status: {status}</span>
                <span>Battery: {battery}</span>
            </div>

            <div style={{ marginBottom: 10 }}>
                <strong>Device Info:</strong> {deviceInfo.name} (FW: {deviceInfo.fw}, HW: {deviceInfo.hw}) <br />
                <strong>Accel:</strong> x={accelerometer.x.toFixed(2)}, y={accelerometer.y.toFixed(2)}, z={accelerometer.z.toFixed(2)}
            </div>

            <div style={{ border: '1px solid #ccc', padding: 10, backgroundColor: 'white', borderRadius: 8 }}>
                <div style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label>
                        <input type="checkbox" checked={filterEnabled} onChange={e => setFilterEnabled(e.target.checked)} />
                        Data Type: {filterEnabled ? 'Filtered (Notch 60Hz)' : 'Raw'}
                    </label>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    {visibleChannels.map((vis, idx) => (
                        <label key={idx} style={{ color: COLORS[idx % COLORS.length] }}>
                            <input type="checkbox" checked={vis} onChange={() => toggleChannel(idx)} />
                            {currentChannelNames[idx] || `Ch ${idx + 1}`}
                        </label>
                    ))}
                </div>

                <EEGGraph data={data} visibleChannels={visibleChannels} />
            </div>
        </div>
    );
}
