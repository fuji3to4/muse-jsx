import { useState, useEffect, useRef } from 'react';
import { EEGDataPoint, RecordingMetadata, saveRecordingMetadata, addEEGDataPoints, getRecordings, deleteRecording, getEEGDataForRecording } from './db';
import { EEGSample } from '../../src/lib/zip-samples';
import { Observable, Subscription, bufferTime } from 'rxjs';
import { athenaChannelNames, channelNames as museChannelNames } from '../../src';

interface EEGRecorderProps {
    stream$: Observable<EEGSample> | null;
    mode: 'muse' | 'athena';
    preset?: string;
    isAuxEnabled: boolean;
    filterSettings: any;
    minimal?: boolean;
    onRecordingsChange?: (count: number) => void;
}

export function EEGRecorder({ stream$, mode, preset, isAuxEnabled, filterSettings, minimal = false, onRecordingsChange }: EEGRecorderProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
    const [recordingId, setRecordingId] = useState<string | null>(null);
    const [samplesCount, setSamplesCount] = useState(0);
    const [deleteEEGOnClose, setDeleteEEGOnClose] = useState(localStorage.getItem('deleteEEGOnClose') !== 'false');

    const subscriptionRef = useRef<Subscription | null>(null);
    const recordingIdRef = useRef<string | null>(null);
    const bufferRef = useRef<EEGSample[]>([]);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const checkIncomplete = async () => {
            const incomplete = localStorage.getItem('incompleteRecording');
            if (incomplete) {
                const list = await getRecordings();
                const meta = list.find(r => r.id === incomplete);
                if (meta && !meta.endTime) {
                    meta.endTime = Date.now();
                    await saveRecordingMetadata(meta);
                }
                localStorage.removeItem('incompleteRecording');
            }
        };

        checkIncomplete().then(() => loadRecordings());

        return () => {
            if (recordingIdRef.current) {
                localStorage.setItem('incompleteRecording', recordingIdRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'deleteEEGOnClose') {
                setDeleteEEGOnClose(e.newValue !== 'false');
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const loadRecordings = async () => {
        const list = await getRecordings();
        setRecordings(list.sort((a, b) => b.startTime - a.startTime));
        onRecordingsChange?.(list.length);
    };

    const startRecording = async () => {
        if (!stream$) return;

        bufferRef.current = [];

        const id = new Date().toISOString().replace(/[:.]/g, '-');
        const channelNames = mode === 'athena' ? athenaChannelNames : (isAuxEnabled ? museChannelNames : museChannelNames.slice(0, 4));

        const metadata: RecordingMetadata = {
            id,
            startTime: Date.now(),
            mode,
            preset,
            sampleRate: 256,
            channels: channelNames,
            filterSettings: { ...filterSettings }
        };

        await saveRecordingMetadata(metadata);
        recordingIdRef.current = id;
        setRecordingId(id);
        setSamplesCount(0);
        setIsRecording(true);
        bufferRef.current = [];

        const handleVisibilityChange = () => {
            if (document.hidden && recordingIdRef.current) {
                stopRecording();
            }
        };

        visibilityHandlerRef.current = handleVisibilityChange;
        window.addEventListener('visibilitychange', handleVisibilityChange);

        subscriptionRef.current = stream$.subscribe(async (sample) => {
            bufferRef.current.push(sample);
            if (bufferRef.current.length >= 256) { // 1 second worth at 256Hz
                const samples = bufferRef.current.splice(0, 256);
                const dataPoints: EEGDataPoint[] = samples.map(s => ({
                    recordingId: recordingIdRef.current!,
                    timestamp: s.timestamp,
                    index: s.index,
                    data: s.data
                }));
                await addEEGDataPoints(dataPoints);
                setSamplesCount(prev => prev + dataPoints.length);
            }
        });
    };

    const stopRecording = async () => {
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
            subscriptionRef.current = null;
        }

        if (visibilityHandlerRef.current) {
            window.removeEventListener('visibilitychange', visibilityHandlerRef.current);
            visibilityHandlerRef.current = null;
        }

        // Flush remaining buffer
        if (bufferRef.current.length > 0 && recordingIdRef.current) {
            const samples = bufferRef.current.splice(0);
            const dataPoints: EEGDataPoint[] = samples.map(s => ({
                recordingId: recordingIdRef.current!,
                timestamp: s.timestamp,
                index: s.index,
                data: s.data
            }));
            await addEEGDataPoints(dataPoints);
            setSamplesCount(prev => prev + dataPoints.length);
        }

        if (recordingIdRef.current) {
            const list = await getRecordings();
            const metadata = list.find(r => r.id === recordingIdRef.current);
            if (metadata) {
                metadata.endTime = Date.now();
                await saveRecordingMetadata(metadata);
            }
        }

        setIsRecording(false);
        recordingIdRef.current = null;
        setRecordingId(null);
        loadRecordings();
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this recording?')) {
            await deleteRecording(id);
            loadRecordings();
        }
    };

    const exportCSV = async (recording: RecordingMetadata) => {
        const data = await getEEGDataForRecording(recording.id);
        if (data.length === 0) {
            alert('No data found for this recording.');
            return;
        }

        let csv = "Timestamp,Index," + recording.channels.join(",") + "\n";
        data.forEach(p => {
            csv += `${p.timestamp},${p.index},${p.data.join(",")}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `eeg_recording_${recording.id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (minimal) {
        return (
            <div className="glass-panel" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '12px', height: '12px', borderRadius: '50%',
                        background: isRecording ? '#ef4444' : '#475569',
                        boxShadow: isRecording ? '0 0 8px #ef4444' : 'none',
                        animation: isRecording ? 'pulse 2s infinite' : 'none'
                    }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {isRecording ? 'RECORDING' : 'IDLE'}
                    </span>
                    {isRecording && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {samplesCount} samples
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    {!isRecording ? (
                        <button className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.85rem' }} onClick={startRecording} disabled={!stream$}>
                            Start Rec
                        </button>
                    ) : (
                        <button className="btn" style={{ padding: '6px 16px', fontSize: '0.85rem', backgroundColor: '#ef4444', color: 'white' }} onClick={stopRecording}>
                            Stop
                        </button>
                    )}
                </div>
                <style dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes pulse {
                        0% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.5; transform: scale(1.2); }
                        100% { opacity: 1; transform: scale(1); }
                    }
                `}} />
            </div>
        );
    }

    return (
        <div className="glass-panel animate-fade-in" style={{ padding: '24px' }}>
            <h2 style={{ marginTop: 0 }}>EEG Data Logger</h2>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
                Manage saved EEG recordings stored in IndexedDB.
            </div>

            <div style={{ marginTop: '32px' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Saved Recordings</h3>
                <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                        <input
                            type="checkbox"
                            checked={deleteEEGOnClose}
                            onChange={(e) => {
                                const checked = e.target.checked;
                                setDeleteEEGOnClose(checked);
                                localStorage.setItem('deleteEEGOnClose', checked ? '' : 'false');
                            }}
                        />
                        Delete EEG data on page unload
                    </label>
                </div>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {recordings.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                            No recordings yet.
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--panel-border)', textAlign: 'left' }}>
                                    <th style={{ padding: '12px' }}>Date</th>
                                    <th style={{ padding: '12px' }}>Mode</th>
                                    <th style={{ padding: '12px' }}>Duration</th>
                                    <th style={{ padding: '12px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recordings.map(r => {
                                    const duration = r.endTime ? Math.round((r.endTime - r.startTime) / 1000) : null;
                                    return (
                                        <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '12px' }}>{new Date(r.startTime).toLocaleString()}</td>
                                            <td style={{ padding: '12px' }}>
                                                <span className="badge" style={{ background: 'rgba(255,255,255,0.1)' }}>{r.mode}</span>
                                                {r.preset && <span style={{ marginLeft: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.preset}</span>}
                                            </td>
                                            <td style={{ padding: '12px' }}>{duration ? `${duration}s` : 'Recording...'}</td>
                                            <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => exportCSV(r)}>Export CSV</button>
                                                <button className="btn" style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171' }} onClick={() => handleDelete(r.id)}>Delete</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
            `}} />
        </div>
    );
}
