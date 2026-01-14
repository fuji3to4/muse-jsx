import { openDB } from 'idb';

const DB_NAME = 'MuseEEGLogDB';
const STORE_NAME = 'eeg_recordings';
const DATA_STORE_NAME = 'eeg_data';
const PACKET_SESSION_STORE = 'athena_packet_sessions';
const PACKET_DATA_STORE = 'athena_packet_data';

export interface RecordingMetadata {
    id: string;
    startTime: number;
    endTime?: number;
    mode: 'muse' | 'athena';
    preset?: string;
    sampleRate: number;
    channels: string[];
    filterSettings?: Record<string, unknown>;
}

export interface PacketSessionMetadata {
    id: string;
    startTime: number;
    endTime?: number;
    mode: string;
}

export interface PacketDataPoint {
    sessionId: string;
    timestamp: number;
    uuid: string;
    data: Uint8Array;
}

export interface EEGDataPoint {
    recordingId: string;
    timestamp: number;
    index: number;
    data: number[];
}

export async function initDB() {
    return openDB(DB_NAME, 2, {
        // Bump version to 2
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(DATA_STORE_NAME)) {
                const store = db.createObjectStore(DATA_STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('recordingId', 'recordingId', { unique: false });
            }
            if (!db.objectStoreNames.contains(PACKET_SESSION_STORE)) {
                db.createObjectStore(PACKET_SESSION_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(PACKET_DATA_STORE)) {
                const store = db.createObjectStore(PACKET_DATA_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('sessionId', 'sessionId', { unique: false });
            }
        },
    });
}

export async function saveRecordingMetadata(metadata: RecordingMetadata) {
    const db = await initDB();
    await db.put(STORE_NAME, metadata);
}

export async function getRecordings(): Promise<RecordingMetadata[]> {
    const db = await initDB();
    return db.getAll(STORE_NAME);
}

export async function deleteRecording(id: string) {
    const db = await initDB();
    const tx = db.transaction([STORE_NAME, DATA_STORE_NAME], 'readwrite');
    await tx.objectStore(STORE_NAME).delete(id);

    // Delete all data associated with this recording
    const dataStore = tx.objectStore(DATA_STORE_NAME);
    const index = dataStore.index('recordingId');
    let cursor = await index.openKeyCursor(IDBKeyRange.only(id));
    while (cursor) {
        await dataStore.delete(cursor.primaryKey);
        cursor = await cursor.continue();
    }
    await tx.done;
}

export async function addEEGDataPoints(dataPoints: EEGDataPoint[]) {
    const db = await initDB();
    const tx = db.transaction(DATA_STORE_NAME, 'readwrite');
    for (const point of dataPoints) {
        await tx.store.add(point);
    }
    await tx.done;
}

export async function getEEGDataForRecording(recordingId: string): Promise<EEGDataPoint[]> {
    const db = await initDB();
    return db.getAllFromIndex(DATA_STORE_NAME, 'recordingId', recordingId);
}

// --- Packet Logger Operations ---

export async function savePacketSessionMetadata(metadata: PacketSessionMetadata) {
    const db = await initDB();
    await db.put(PACKET_SESSION_STORE, metadata);
}

export async function getPacketSessions(): Promise<PacketSessionMetadata[]> {
    const db = await initDB();
    return db.getAll(PACKET_SESSION_STORE);
}

export async function addPacketDataPoints(dataPoints: PacketDataPoint[]) {
    const db = await initDB();
    const tx = db.transaction(PACKET_DATA_STORE, 'readwrite');
    for (const point of dataPoints) {
        await tx.store.add(point);
    }
    await tx.done;
}

export async function getPacketDataForSession(sessionId: string): Promise<PacketDataPoint[]> {
    const db = await initDB();
    return db.getAllFromIndex(PACKET_DATA_STORE, 'sessionId', sessionId);
}

export async function deletePacketSession(id: string) {
    const db = await initDB();
    const tx = db.transaction([PACKET_SESSION_STORE, PACKET_DATA_STORE], 'readwrite');
    await tx.objectStore(PACKET_SESSION_STORE).delete(id);

    const dataStore = tx.objectStore(PACKET_DATA_STORE);
    const index = dataStore.index('sessionId');
    let cursor = await index.openKeyCursor(IDBKeyRange.only(id));
    while (cursor) {
        await dataStore.delete(cursor.primaryKey);
        cursor = await cursor.continue();
    }
    await tx.done;
}

export async function clearAll() {
    const db = await initDB();
    await db.clear(STORE_NAME);
    await db.clear(DATA_STORE_NAME);
    await db.clear(PACKET_SESSION_STORE);
    await db.clear(PACKET_DATA_STORE);
}
