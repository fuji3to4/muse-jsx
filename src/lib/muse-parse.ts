import { Observable } from 'rxjs';
import { concatMap, scan } from 'rxjs';

import { AccelerometerData, GyroscopeData, MuseControlResponse, TelemetryData } from './muse-interfaces';

function isMuseControlResponse(value: unknown): value is MuseControlResponse {
    if (!value || typeof value !== 'object') return false;
    const rc = (value as { rc?: unknown }).rc;
    return typeof rc === 'number';
}

export function parseControl(controlData: Observable<string>): Observable<MuseControlResponse> {
    return controlData.pipe(
        scan(
            (state, chunk) => {
                let buffer = state.buffer + chunk;
                const parsed: MuseControlResponse[] = [];

                while (true) {
                    const start = buffer.indexOf('{');
                    if (start < 0) {
                        // Keep only a short tail to avoid unbounded growth on non-JSON control text.
                        buffer = buffer.slice(-256);
                        break;
                    }

                    if (start > 0) {
                        buffer = buffer.slice(start);
                    }

                    const end = buffer.indexOf('}');
                    if (end < 0) {
                        break;
                    }

                    const candidate = buffer.slice(0, end + 1);
                    buffer = buffer.slice(end + 1);

                    try {
                        const parsedCandidate: unknown = JSON.parse(candidate);
                        if (isMuseControlResponse(parsedCandidate)) {
                            parsed.push(parsedCandidate);
                        }
                    } catch {
                        // Ignore malformed frames and continue scanning.
                    }
                }

                return { buffer, parsed };
            },
            { buffer: '', parsed: [] as MuseControlResponse[] },
        ),
        concatMap((state) => state.parsed),
    );
}

export function decodeUnsigned12BitData(samples: Uint8Array) {
    const samples12Bit = [];
    // tslint:disable:no-bitwise
    for (let i = 0; i < samples.length; i++) {
        if (i % 3 === 0) {
            samples12Bit.push((samples[i] << 4) | (samples[i + 1] >> 4));
        } else {
            samples12Bit.push(((samples[i] & 0xf) << 8) | samples[i + 1]);
            i++;
        }
    }
    // tslint:enable:no-bitwise
    return samples12Bit;
}

export function decodeUnsigned24BitData(samples: Uint8Array) {
    const samples24Bit = [];
    // tslint:disable:no-bitwise
    for (let i = 0; i < samples.length; i = i + 3) {
        samples24Bit.push((samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2]);
    }
    // tslint:enable:no-bitwise
    return samples24Bit;
}

export function decodeEEGSamples(samples: Uint8Array) {
    return decodeUnsigned12BitData(samples).map((n) => 0.48828125 * (n - 0x800));
}

export function decodePPGSamples(samples: Uint8Array) {
    // Decode data packet of one PPG channel.
    // Each packet is encoded with a 16bit timestamp followed by 6
    // samples with a 24 bit resolution.
    return decodeUnsigned24BitData(samples);
}

export function parseTelemetry(data: DataView): TelemetryData {
    // tslint:disable:object-literal-sort-keys
    return {
        sequenceId: data.getUint16(0),
        batteryLevel: data.getUint16(2) / 512,
        fuelGaugeVoltage: data.getUint16(4) * 2.2,
        // Next 2 bytes are probably ADC millivolt level, not sure
        temperature: data.getUint16(8),
    };
    // tslint:enable:object-literal-sort-keys
}

function parseImuReading(data: DataView, scale: number) {
    function sample(startIndex: number) {
        return {
            x: scale * data.getInt16(startIndex),
            y: scale * data.getInt16(startIndex + 2),
            z: scale * data.getInt16(startIndex + 4),
        };
    }
    // tslint:disable:object-literal-sort-keys
    return {
        sequenceId: data.getUint16(0),
        samples: [sample(2), sample(8), sample(14)],
    };
    // tslint:enable:object-literal-sort-keys
}

export function parseAccelerometer(data: DataView): AccelerometerData {
    return parseImuReading(data, 0.0000610352);
}

export function parseGyroscope(data: DataView): GyroscopeData {
    return parseImuReading(data, 0.0074768);
}
