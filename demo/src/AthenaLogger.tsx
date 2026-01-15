import React, { useState, useEffect, useRef } from 'react';
import { MuseClient } from '../../src/muse';
import { MuseAthenaClient } from '../../src/muse-athena';
import { bufferTime } from 'rxjs';
import {
    savePacketSessionMetadata,
    addPacketDataPoints,
    getPacketSessions,
    deletePacketSession,
    getPacketDataForSession,
    PacketSessionMetadata,
    PacketDataPoint
} from './db';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface PacketLoggerProps {
    clientRef: React.MutableRefObject<MuseClient | MuseAthenaClient | null>;
    status: ConnectionStatus;
    preset?: string;
}

export function AthenaLogger({ clientRef, status, preset }: PacketLoggerProps) {
    const [isLogging, setIsLogging] = useState(false);
    const [sessions, setSessions] = useState<PacketSessionMetadata[]>([]);
    const [capturedCount, setCapturedCount] = useState(0);
    const [recentPackets, setRecentPackets] = useState<{ timestamp: string, uuid: string, hex: string }[]>([]);
    const [deletePacketOnClose, setDeletePacketOnClose] = useState(localStorage.getItem('deletePacketOnClose') !== 'false');

    const sessionIdRef = useRef<string | null>(null);
    const currentPacketsRef = useRef<{ timestamp: number, uuid: string, data: Uint8Array }[]>([]);

    useEffect(() => {
        loadSessions();
    }, []);

    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'deletePacketOnClose') {
                setDeletePacketOnClose(e.newValue !== 'false');
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const loadSessions = async () => {
        const list = await getPacketSessions();
        setSessions(list.sort((a, b) => b.startTime - a.startTime));
    };

    useEffect(() => {
        const client = clientRef.current;
        if (!client || !isLogging || !(client instanceof MuseAthenaClient) || !client.rawPackets) {
            return;
        }

        const id = `athena-pkg-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        sessionIdRef.current = id;

        savePacketSessionMetadata({
            id,
            startTime: Date.now(),
            mode: 'athena',
            preset
        });

        const sub = client.rawPackets.pipe(
            bufferTime(1000)
        ).subscribe(async (buffer) => {
            if (buffer.length === 0 || !sessionIdRef.current) return;

            const dataPoints: PacketDataPoint[] = buffer.map(p => ({
                sessionId: sessionIdRef.current!,
                timestamp: p.timestamp,
                uuid: p.uuid,
                data: p.data
            }));

            await addPacketDataPoints(dataPoints);
            setCapturedCount(prev => prev + dataPoints.length);

            // Update internal buffer for UI display (last 50)
            currentPacketsRef.current = [...currentPacketsRef.current, ...buffer].slice(-50);

            const displayPackets = currentPacketsRef.current.map(p => {
                const hex = Array.from(p.data, (b) => b.toString(16).padStart(2, '0')).join('');
                return {
                    timestamp: new Date(p.timestamp).toISOString().split('T')[1],
                    uuid: p.uuid ? p.uuid.substring(0, 8) : 'unknown',
                    hex
                };
            });
            setRecentPackets(displayPackets);
        });

        return () => {
            sub.unsubscribe();
            if (sessionIdRef.current) {
                const finalId = sessionIdRef.current;
                getPacketSessions().then(list => {
                    const meta = list.find(s => s.id === finalId);
                    if (meta) {
                        meta.endTime = Date.now();
                        savePacketSessionMetadata(meta).then(loadSessions);
                    }
                });
            }
            sessionIdRef.current = null;
        };
    }, [clientRef, isLogging, status]);

    const downloadSession = async (session: PacketSessionMetadata) => {
        const data = await getPacketDataForSession(session.id);
        if (data.length === 0) return;

        let content = "Timestamp,UUID,HexData\n";
        data.forEach(p => {
            const hex = Array.from(p.data, (b) => b.toString(16).padStart(2, '0')).join('');
            const ts = new Date(p.timestamp).toISOString();
            content += `${ts},${p.uuid},${hex}\n`;
        });

        const blob = new Blob([content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `athena_packets_${session.id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDelete = async (id: string) => {
        if (confirm('Delete this packet log?')) {
            await deletePacketSession(id);
            loadSessions();
        }
    };

    return (
        <div className="glass-panel animate-fade-in" style={{ padding: '24px' }}>
            <h2 style={{ marginTop: 0 }}>Athena Packet Logger</h2>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
                Capture raw Bluetooth traffic to IndexedDB.
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center' }}>
                <button
                    className="btn"
                    onClick={() => {
                        if (isLogging) {
                            setIsLogging(false);
                            setCapturedCount(0);
                            setRecentPackets([]);
                            currentPacketsRef.current = [];
                        } else {
                            setIsLogging(true);
                        }
                    }}
                    disabled={status !== 'connected'}
                    style={{ backgroundColor: isLogging ? '#ef4444' : '#10b981', color: 'white' }}
                >
                    {isLogging ? 'Stop Recording' : 'Start Packet Recording'}
                </button>

                {isLogging && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="badge" style={{ backgroundColor: '#ef4444', color: 'white', animation: 'pulse 2s infinite' }}>REC</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{capturedCount} packets</span>
                    </div>
                )}
            </div>

            {isLogging && recentPackets.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                    <strong style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Live Stream (Last 50):</strong>
                    <div style={{ marginTop: '8px', maxHeight: '150px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '11px' }}>
                        {recentPackets.map((p, i) => (
                            <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{p.timestamp}</span> <span style={{ color: 'var(--accent)' }}>{p.uuid}</span> {p.hex}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', borderTop: '1px solid var(--panel-border)', paddingTop: '24px' }}>Saved Packet Logs</h3>
            <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                    <input
                        type="checkbox"
                        checked={deletePacketOnClose}
                        onChange={(e) => {
                            const checked = e.target.checked;
                            setDeletePacketOnClose(checked);
                            localStorage.setItem('deletePacketOnClose', checked ? '' : 'false');
                        }}
                    />
                    Delete packet logs on page unload
                </label>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {sessions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                        No logs saved.
                    </div>
                ) : (
                    <table style={{ width: '100%' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--panel-border)' }}>
                                <th style={{ padding: '12px' }}>Date</th>
                                <th style={{ padding: '12px' }}>Mode</th>
                                <th style={{ padding: '12px' }}>Duration</th>
                                <th style={{ padding: '12px' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.map(s => (
                                <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '12px' }}>{new Date(s.startTime).toLocaleString()}</td>
                                    <td style={{ padding: '12px' }}>
                                        <span className="badge" style={{ background: 'rgba(255,255,255,0.1)' }}>{s.mode}</span>
                                        {s.preset && <span style={{ marginLeft: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.preset}</span>}
                                    </td>
                                    <td style={{ padding: '12px' }}>{s.endTime ? `${Math.round((s.endTime - s.startTime) / 1000)}s` : 'Recording...'}</td>
                                    <td style={{ padding: '12px', display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => downloadSession(s)}>Export CSV</button>
                                        <button className="btn" style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171' }} onClick={() => handleDelete(s.id)}>Delete</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
