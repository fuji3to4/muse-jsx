import React, { useState, useEffect, useRef } from 'react';
import { MuseClient } from '../../src/muse';
import { MuseAthenaClient } from '../../src/muse-athena';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface PacketLoggerProps {
    clientRef: React.MutableRefObject<MuseClient | MuseAthenaClient | null>;
    status: ConnectionStatus;
}

export function AthenaLogger({ clientRef, status }: PacketLoggerProps) {
    const [packets, setPackets] = useState<{ timestamp: string, uuid: string, hex: string }[]>([]);
    const [isLogging, setIsLogging] = useState(true);
    const packetsRef = useRef<{ timestamp: number, uuid: string, data: Uint8Array }[]>([]);
    const [capturedCount, setCapturedCount] = useState(0);

    useEffect(() => {
        const client = clientRef.current;
        if (!client || !isLogging || !(client instanceof MuseAthenaClient) || !client.rawPackets) {
            console.log('[AthenaLogger] Waiting for client or rawPackets...');
            return;
        }

        console.log('[AthenaLogger] Starting packet subscription');
        const sub = client.rawPackets.subscribe({
            next: (packet) => {
                packetsRef.current.push(packet);
                if (packetsRef.current.length > 50000) { // Limit buffer size to 50k for safety
                    packetsRef.current.shift();
                }
            },
            error: (err) => console.error('[AthenaLogger] Subscription error:', err)
        });

        // Throttle UI update to 2Hz (every 500ms) to avoid React overload
        const interval = setInterval(() => {
            try {
                const count = packetsRef.current.length;
                setCapturedCount(count);

                // Show last 200 packets in UI for better context
                const last200 = packetsRef.current.slice(-200).map(p => {
                    const hex = p.data ? Array.from(p.data, (b) => b.toString(16).padStart(2, '0')).join('') : 'no-data';
                    return {
                        timestamp: new Date(p.timestamp).toISOString().split('T')[1],
                        uuid: p.uuid ? p.uuid.substring(0, 8) : 'unknown',
                        hex
                    };
                });
                setPackets(last200);
            } catch (err) {
                console.error('[AthenaLogger] UI update error:', err);
            }
        }, 500);

        return () => {
            sub.unsubscribe();
            clearInterval(interval);
        };
    }, [clientRef, isLogging, status]);

    // Clear UI state when logging stops
    useEffect(() => {
        if (!isLogging) {
            setPackets([]);
        }
    }, [isLogging]);

    const downloadLogs = () => {
        const allPackets = packetsRef.current;
        if (allPackets.length === 0) return;

        let content = "Timestamp,UUID,HexData\n";
        allPackets.forEach(p => {
            const hex = Array.from(p.data, (b) => b.toString(16).padStart(2, '0')).join('');
            const ts = new Date(p.timestamp).toISOString();
            content += `${ts},${p.uuid},${hex}\n`;
        });

        const blob = new Blob([content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `athena_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const clearLogs = () => {
        packetsRef.current = [];
        setPackets([]);
        setCapturedCount(0);
    };

    return (
        <div className="glass-panel animate-fade-in" style={{ padding: '24px' }}>
            <h2 style={{ marginTop: 0 }}>Athena Packet Logger</h2>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
                Capture raw Bluetooth traffic from the Athena device for reverse engineering.
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button
                    className="btn"
                    onClick={() => setIsLogging(!isLogging)}
                    disabled={status !== 'connected'}
                    style={{ backgroundColor: isLogging ? 'var(--danger)' : '#10b981', color: 'white' }}
                >
                    {isLogging ? 'Stop Logging' : 'Start Logging'}
                </button>

                <button className="btn btn-outline" onClick={downloadLogs} disabled={capturedCount === 0}>
                    Download Logs ({capturedCount})
                </button>

                <button className="btn btn-outline" onClick={clearLogs} disabled={capturedCount === 0}>
                    Clear Logs
                </button>
            </div>

            <div>
                <strong style={{ color: 'var(--text-muted)' }}>Captured Packets:</strong> <span style={{ color: 'var(--accent)' }}>{capturedCount}</span>
                {packets.length > 0 && (
                    <div style={{ marginTop: '16px', maxHeight: '300px', overflowY: 'auto', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '12px' }}>
                        {packets.map((p, i) => {
                            return (
                                <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{p.timestamp}</span>{' '}
                                    <span style={{ color: 'var(--accent)' }}>{p.uuid}</span>... {p.hex}
                                </div>
                            );
                        })}
                        {capturedCount > 200 && <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)' }}>... (showing last 200, download to see all {capturedCount})</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
