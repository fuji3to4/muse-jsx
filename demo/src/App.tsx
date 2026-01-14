import React, { useState, useEffect } from 'react';
import { LineChart, Line, YAxis, Legend, ResponsiveContainer } from 'recharts';
import {
    MuseClient,
    MuseAthenaClient,
    channelNames as museChannelNames,
    athenaChannelNames,
    ATHENA_PRESETS,
    AthenaPreset,
    zipSamples
} from '../../src';
import { notchFilter, bandpassFilter, epoch } from '@neurosity/pipes';
import { tap, map, BehaviorSubject, switchMap, Subscription, Observable } from 'rxjs';
import { AthenaLogger } from './AthenaLogger';

// --- Types ---

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type FilterSettings = {
    notchEnabled: boolean;
    notchFrequency: number;
    bandpassEnabled: boolean;
    bandpassLow: number;
    bandpassHigh: number;
};

type Reading = {
    index: number;
    timestamp: number;
    [key: string]: number; // ch0, ch1, ...
};

// --- Hook for Muse Logic ---

function useMuse(mode: 'muse' | 'athena', enableAux: boolean, view: 'graph' | 'logger', preset: AthenaPreset = 'p1045') {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [battery, setBattery] = useState<string>('unknown');
    const [accelerometer, setAccelerometer] = useState({ x: 0, y: 0, z: 0 });
    const [data, setData] = useState<Reading[]>([]);

    const [filterSettings, setFilterSettings] = useState<FilterSettings>({
        notchEnabled: true,
        notchFrequency: 60,
        bandpassEnabled: true,
        bandpassLow: 5,
        bandpassHigh: 40
    });

    const clientRef = React.useRef<MuseClient | MuseAthenaClient | null>(null);
    const subscriptionsRef = React.useRef<Subscription[]>([]);
    const filterSettings$ = React.useRef(new BehaviorSubject<FilterSettings>(filterSettings));

    // Update the subject when state changes
    useEffect(() => {
        filterSettings$.current.next(filterSettings);
    }, [filterSettings]);

    // Update setData logic is now handled in the stream pipeline via epoch

    const connect = async () => {
        if (status === 'connected' || status === 'connecting') return;

        try {
            setStatus('connecting');
            const client = mode === 'athena' ? new MuseAthenaClient() : new MuseClient();
            clientRef.current = client;

            if (mode === 'muse' && client instanceof MuseClient) {
                client.enableAux = enableAux;
            }

            // Cleanup previous subscriptions if reconnecting
            subscriptionsRef.current.forEach(s => s.unsubscribe());
            subscriptionsRef.current = [];

            // Sync connection status with component state
            subscriptionsRef.current.push(client.connectionStatus.subscribe(connected => {
                if (!connected && status !== 'disconnected') {
                    setStatus('disconnected');
                }
            }));

            await client.connect();
            setStatus('connected');

            // Handle deviceInfo based on mode
            if (mode === 'muse') {
                // Classic Muse needs a moment to stabilize after multiple startNotifications calls
                // and sequential GATT operations to avoid conflicts
                await new Promise(resolve => setTimeout(resolve, 500));
                try {
                    const info = await (client as any).deviceInfo();
                    console.log('[useMuse] Classic Device Connected:', info);
                } catch (err) {
                    console.warn('Could not retrieve classic device info', err);
                }
            } else {
                // Athena: Non-blocking as requested
                (client as any).deviceInfo().then((info: any) => {
                    console.log('[useMuse] Athena Device Connected:', info);
                }).catch((err: any) => {
                    console.warn('Could not retrieve Athena device info', err);
                });
            }

            if (client instanceof MuseAthenaClient) {
                await client.start(preset);
            } else {
                await client.start();
            }

        } catch (e: any) {
            console.error('Connection error:', e);
            setStatus('disconnected');
            // If the error happens during connection, give a hint
            if (e.message?.includes('GATT')) {
                alert('Connection failed: Device might have disconnected. Please try again.');
            }
        }
    };

    // --- View-Dependent Stream Management ---
    useEffect(() => {
        const client = clientRef.current;
        if (status !== 'connected' || !client) {
            subscriptionsRef.current.forEach(s => s.unsubscribe());
            subscriptionsRef.current = [];
            return;
        }

        // Cleanup any previous view-specific subscriptions
        subscriptionsRef.current.forEach(s => s.unsubscribe());
        subscriptionsRef.current = [];

        if (view === 'graph') {
            console.log('[useMuse] Switching to Graph mode - Starting EEG stream');
            const nbChannels = mode === 'athena' ? 8 : (enableAux ? 5 : 4);
            const samplingRate = 256;

            // Sensors (Battery/Accel)
            if (client instanceof MuseClient) {
                subscriptionsRef.current.push(client.telemetryData.subscribe(t => {
                    setBattery(t.batteryLevel.toFixed(2) + '%');
                }));
                subscriptionsRef.current.push(client.accelerometerData.subscribe(accel => {
                    setAccelerometer({ x: accel.samples[2].x, y: accel.samples[2].y, z: accel.samples[2].z });
                }));
            } else if (client instanceof MuseAthenaClient) {
                subscriptionsRef.current.push(client.batteryData.subscribe(t => {
                    setBattery(String(t.values[0] || '?'));
                }));
                subscriptionsRef.current.push(client.accGyroReadings.subscribe(accel => {
                    setAccelerometer({ x: accel.acc?.x || 0, y: accel.acc?.y || 0, z: accel.acc?.z || 0 });
                }));
            }

            // EEG with dynamic filtering
            subscriptionsRef.current.push(filterSettings$.current.pipe(
                switchMap(settings => {
                    if (!clientRef.current || !client.eegReadings) return [];
                    let stream = client.eegReadings.pipe(
                        //For debug all eeg logs
                        // tap(r => {
                        //     console.log(`[RAW EEG] ${mode.toUpperCase()} ch=${r.electrode} i=${r.index} t=${r.timestamp.toFixed(1)} sl=${r.samples.length} samples=[${r.samples[0].toFixed(1)}, ...]`);
                        // }),
                        zipSamples
                    );
                    if (settings.notchEnabled) {
                        stream = stream.pipe(notchFilter({ nbChannels, cutoffFrequency: settings.notchFrequency }));
                    }
                    if (settings.bandpassEnabled) {
                        stream = stream.pipe(bandpassFilter({
                            nbChannels,
                            cutoffFrequencies: [settings.bandpassLow, settings.bandpassHigh],
                            samplingRate
                        }));
                    }

                    // Add epoch to window the data for the graph
                    // duration: 250 samples (~1 second view)
                    // interval: 25 samples (~100ms update frequency / 10fps)
                    return (stream.pipe(
                        epoch({ duration: 250, interval: 25, samplingRate }) as any
                    ) as Observable<any>).pipe(
                        map((epoched: { data: number[][], info: any }) => {
                            // Convert from [channel][sample] to [sample]{ ch0, ch1, ... }
                            const numSamples = epoched.data[0].length;
                            const readings: Reading[] = [];
                            for (let i = 0; i < numSamples; i++) {
                                const reading: Reading = { index: i, timestamp: Date.now() };
                                epoched.data.forEach((chData: number[], chIdx: number) => {
                                    reading[`ch${chIdx}`] = chData[i];
                                });
                                readings.push(reading);
                            }
                            return readings;
                        }),
                        tap((readings: Reading[]) => setData(readings))
                    );
                }),
            ).subscribe({
                next: () => {
                },
                error: (err) => {
                    console.error('[App] EEG Stream error:', err);
                    if (err.message?.includes('GATT')) setStatus('disconnected');
                },
                complete: () => {
                    console.warn('[App] EEG Stream completed (unexpectedly)');
                }
            }));
        } else if (view === 'logger') {
            console.log('[useMuse] Switching to Logger mode - EEG processing stopped');
            // PacketLogger component handles its own subscription when mounted
            // We just ensure EEG/Sensors are NOT subscribed here (handled by the cleanup at top)
        }

        return () => {
            subscriptionsRef.current.forEach(s => s.unsubscribe());
            subscriptionsRef.current = [];
        };
    }, [status, view, mode, enableAux]);


    const disconnect = async () => {
        if (clientRef.current) {
            clientRef.current.disconnect();
            clientRef.current = null;
        }
        setStatus('disconnected');
    };

    // Clear buffer when switching connection or mode or view
    useEffect(() => {
        setData([]);
    }, [mode, status, view]);

    return {
        connect,
        disconnect,
        status,
        battery,
        accelerometer,
        data,
        filterSettings,
        setFilterSettings,
        clientRef
    };
}

const COLORS = ['#B34D4D', '#00B3E6', '#E6B333', '#99FF99', '#FF33FF', '#3366E6', '#999966', '#FF6633', '#FFB399', '#FFFF99'];

// --- Filter Controls Component ---

function FilterControls({
    settings,
    setSettings
}: {
    settings: FilterSettings,
    setSettings: React.Dispatch<React.SetStateAction<FilterSettings>>
}) {
    const updateSetting = (key: keyof FilterSettings, value: any) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Filter Settings</h3>
            <div className="grid grid-cols-2" style={{ gap: '24px' }}>
                {/* Notch Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <label className="checkbox-wrapper">
                        <input
                            type="checkbox"
                            checked={settings.notchEnabled}
                            onChange={e => updateSetting('notchEnabled', e.target.checked)}
                        />
                        <span style={{ fontWeight: 600 }}>Notch Filter</span>
                    </label>
                    <div className="input-group">
                        <label>Frequency (Hz)</label>
                        <input
                            type="number"
                            value={settings.notchFrequency}
                            onChange={e => updateSetting('notchFrequency', Number(e.target.value))}
                            disabled={!settings.notchEnabled}
                        />
                    </div>
                </div>

                {/* Bandpass Filter */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <label className="checkbox-wrapper">
                        <input
                            type="checkbox"
                            checked={settings.bandpassEnabled}
                            onChange={e => updateSetting('bandpassEnabled', e.target.checked)}
                        />
                        <span style={{ fontWeight: 600 }}>Bandpass Filter</span>
                    </label>
                    <div className="grid grid-cols-2" style={{ gap: '12px' }}>
                        <div className="input-group">
                            <label>Low Cut (Hz)</label>
                            <input
                                type="number"
                                value={settings.bandpassLow}
                                onChange={e => updateSetting('bandpassLow', Number(e.target.value))}
                                disabled={!settings.bandpassEnabled}
                            />
                        </div>
                        <div className="input-group">
                            <label>High Cut (Hz)</label>
                            <input
                                type="number"
                                value={settings.bandpassHigh}
                                onChange={e => updateSetting('bandpassHigh', Number(e.target.value))}
                                disabled={!settings.bandpassEnabled}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function EEGGraph({
    data,
    visibleChannels,
    channelNames,
    yRange
}: {
    data: Reading[],
    visibleChannels: boolean[],
    channelNames: string[],
    yRange: number
}) {
    if (data.length === 0) return (
        <div style={{ height: 400, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
            No Data Stream
        </div>
    );

    return (
        <div className="glass-panel" style={{ height: 500, width: '100%', padding: '10px' }}>
            <ResponsiveContainer>
                <LineChart data={data}>
                    <YAxis domain={[-yRange, yRange]} stroke="#475569" fontSize={12} allowDataOverflow={true} />
                    <Legend verticalAlign="top" height={36} />
                    {visibleChannels.map((visible, idx) => (
                        visible && (
                            <Line
                                key={idx}
                                type="monotone"
                                dataKey={`ch${idx}`}
                                name={channelNames[idx] || `Ch ${idx + 1}`}
                                stroke={COLORS[idx % COLORS.length]}
                                dot={false}
                                isAnimationActive={false}
                                strokeWidth={1.5}
                            />
                        )
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}


// --- Main App ---

export default function App() {
    // URL-based routing to ensure absolute separation
    const urlParams = new URLSearchParams(window.location.search);
    const initialView = urlParams.get('view') === 'logger' ? 'logger' : 'graph';

    const [mode, setMode] = useState<'muse' | 'athena'>('athena');
    const [enableAux, setEnableAux] = useState(false);
    const [currentView] = useState<'graph' | 'logger'>(initialView);
    const [selectedPreset, setSelectedPreset] = useState<AthenaPreset>('p1045');
    const [visibleChannels, setVisibleChannels] = useState<boolean[]>(new Array(8).fill(true));
    const [yRange, setYRange] = useState(200);

    const switchView = (v: 'graph' | 'logger') => {
        const url = new URL(window.location.href);
        url.searchParams.set('view', v);
        window.location.href = url.toString(); // Full reload to ensure absolute cleanup
    };

    const { connect, disconnect, status, battery, accelerometer, data, filterSettings, setFilterSettings, clientRef }
        = useMuse(mode, enableAux, currentView, selectedPreset);

    // Force Athena mode if in Logger view
    useEffect(() => {
        if (currentView === 'logger' && mode !== 'athena') {
            setMode('athena');
        }
    }, [currentView, mode]);


    const currentChannelNames = mode === 'athena' ? athenaChannelNames : museChannelNames;

    useEffect(() => {
        const count = mode === 'athena' ? 8 : (enableAux ? 5 : 4);
        setVisibleChannels(new Array(8).fill(false).map((_, i) => {
            if (i >= count) return false;
            const name = currentChannelNames[i] || '';
            return !name.includes('AUX');
        }));
    }, [mode, enableAux, currentChannelNames]);

    const toggleChannel = (idx: number) => {
        setVisibleChannels(prev => {
            const next = [...prev];
            next[idx] = !next[idx];
            return next;
        });
    };

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
            <header style={{ marginBottom: '40px', textAlign: 'center' }}>
                <h1 style={{ fontSize: '3rem', margin: '0 0 8px 0', background: 'linear-gradient(to right, #6366f1, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Muse JSX</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Electrophysiology for the modern web.</p>
            </header>

            <nav className="tab-nav">
                <button
                    className={`tab-btn ${currentView === 'graph' ? 'active' : ''}`}
                    onClick={() => switchView('graph')}
                >
                    EEG Graph
                </button>
                <button
                    className={`tab-btn ${currentView === 'logger' ? 'active' : ''}`}
                    onClick={() => switchView('logger')}
                    disabled={mode !== 'athena'}
                >
                    Athena Packet Logger
                </button>
            </nav>

            <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '24px' }}>
                <main style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Connection Panel */}
                    <div className="glass-panel" style={{ padding: '24px' }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="input-group">
                                <label>Device Mode</label>
                                <select value={mode} onChange={e => setMode(e.target.value as any)} disabled={status === 'connected'}>
                                    <option value="athena">Athena</option>
                                    <option value="muse" disabled={currentView === 'logger'}>Muse (Classic)</option>
                                </select>
                            </div>

                            {mode === 'athena' && (
                                <div className="input-group">
                                    <label>Start Preset</label>
                                    <select
                                        value={selectedPreset}
                                        onChange={e => setSelectedPreset(e.target.value as AthenaPreset)}
                                        disabled={status === 'connected'}
                                    >
                                        {ATHENA_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                            )}

                            {mode === 'muse' && (
                                <label className="checkbox-wrapper" style={{ paddingBottom: '10px' }}>
                                    <input type="checkbox" checked={enableAux} onChange={e => setEnableAux(e.target.checked)} disabled={status === 'connected'} />
                                    <span>Enable Aux</span>
                                </label>
                            )}

                            <button
                                className={`btn ${status === 'connected' ? 'btn-outline' : 'btn-primary'}`}
                                onClick={status === 'connected' ? disconnect : connect}
                                disabled={status === 'connecting'}
                            >
                                {status === 'connected' ? 'Disconnect' : (status === 'connecting' ? 'Connecting...' : 'Connect Device')}
                            </button>
                        </div>

                        <div style={{ marginTop: '20px', display: 'flex', gap: '24px', fontSize: '0.9rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                                <span className={`badge ${status === 'connected' ? 'badge-success' : 'badge-danger'}`}>
                                    {status.toUpperCase()}
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Battery:</span>
                                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{battery}</span>
                            </div>
                        </div>
                    </div>

                    {currentView === 'graph' && (
                        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <FilterControls
                                settings={filterSettings}
                                setSettings={setFilterSettings}
                            />

                            <div className="glass-panel" style={{ padding: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h3 style={{ margin: 0 }}>EEG Channels</h3>
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                        {visibleChannels.map((vis, idx) => (
                                            <label
                                                key={idx}
                                                className="checkbox-wrapper"
                                                style={{ fontSize: '0.85rem', color: COLORS[idx % COLORS.length], border: `1px solid ${vis ? COLORS[idx % COLORS.length] : 'var(--panel-border)'}`, padding: '4px 8px', borderRadius: '6px', background: vis ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                                            >
                                                <input type="checkbox" checked={vis} onChange={() => toggleChannel(idx)} />
                                                {currentChannelNames[idx] || `Ch ${idx + 1}`}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <EEGGraph
                                    data={data}
                                    visibleChannels={visibleChannels}
                                    channelNames={currentChannelNames}
                                    yRange={yRange}
                                />

                                <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)' }}>
                                    <div className="input-group" style={{ maxWidth: '400px' }}>
                                        <label style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                                            <span>Y-Axis Range (± µV)</span>
                                            <span style={{ color: 'var(--accent)' }}>{yRange} µV</span>
                                        </label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>10</span>
                                            <input
                                                type="range"
                                                min="10"
                                                max="1000"
                                                step="10"
                                                value={yRange}
                                                onChange={e => setYRange(Number(e.target.value))}
                                                style={{ flex: 1 }}
                                            />
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>1000</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentView === 'logger' && mode === 'athena' && (
                        <AthenaLogger
                            clientRef={clientRef}
                            status={status}
                        />
                    )}

                    {currentView === 'logger' && mode !== 'athena' && (
                        <div className="glass-panel" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            Packet Logger is only available for Athena / Muse S (Gen 3) devices.
                        </div>
                    )}
                </main>

                {currentView === 'graph' && (
                    <aside style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div className="glass-panel" style={{ padding: '20px' }}>
                            <h3 style={{ marginTop: 0, fontSize: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>Sensors</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accelerometer</label>
                                    <div className="grid grid-cols-2" style={{ marginTop: '8px', fontSize: '0.9rem' }}>
                                        <div><span style={{ color: 'var(--text-muted)' }}>X:</span> {accelerometer.x.toFixed(2)}</div>
                                        <div><span style={{ color: 'var(--text-muted)' }}>Y:</span> {accelerometer.y.toFixed(2)}</div>
                                        <div><span style={{ color: 'var(--text-muted)' }}>Z:</span> {accelerometer.z.toFixed(2)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel" style={{ padding: '20px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            <p style={{ margin: 0 }}>Tip: Real-time filtering uses RxJS pipes for low-latency signal processing.</p>
                        </div>
                    </aside>
                )}
            </div >
        </div >
    );
}
