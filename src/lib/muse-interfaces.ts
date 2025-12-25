export interface EEGReading {
    index: number;
    electrode: number; // 0 to 4
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 12 samples each time
}

export interface PPGReading {
    index: number;
    ppgChannel: number; // 0 to 2
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 6 samples each time
}

export interface TelemetryData {
    sequenceId: number;
    batteryLevel: number;
    fuelGaugeVoltage: number;
    temperature: number;
}

export interface XYZ {
    x: number;
    y: number;
    z: number;
}

export interface AccelerometerData {
    sequenceId: number;
    samples: XYZ[];
}

export interface MuseControlResponse {
    rc: number;
    [key: string]: string | number;
}

export interface MuseDeviceInfo extends MuseControlResponse {
    ap: string;
    bl: string;
    bn: number;
    fw: string;
    hw: string;
    pv: number;
    sp: string;
    tp: string;
}

export interface EventMarker {
    value: string | number;
    timestamp: number;
}

export type GyroscopeData = AccelerometerData;
// Athena-specific interfaces (compatible with muse.ts structure)
export interface AthenaEEGReading {
    index: number; // Event index (for timestamp calculation)
    electrode: number; // Channel 0-7 (8 channels total)
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 2 EEG samples at 256 Hz
}

export interface AthenaAccGyroSample {
    index: number; // Event index
    timestamp: number; // milliseconds since epoch
    acc?: XYZ; // Single ACC sample at 52 Hz
    gyro?: XYZ; // Single GYRO sample at 52 Hz
}

export interface AthenaOpticalReading {
    index: number; // Event index
    opticalChannel: number; // Channel 0-2 (ambient, IR, red)
    timestamp: number; // milliseconds since epoch
    samples: number[]; // 4 optical values at 64 Hz
}

export interface AthenaBatteryData {
    timestamp: number;
    values: number[]; // 10 battery values
}
