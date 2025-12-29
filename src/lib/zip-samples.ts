import { from, Observable } from 'rxjs';
import { concatWith, mergeMap } from 'rxjs';
import { EEG_FREQUENCY } from './../muse';
import { EEGReading } from './muse-interfaces';

export interface EEGSample {
    index: number;
    timestamp: number; // milliseconds since epoch
    data: number[];
}

export function zipSamples(eegReadings: Observable<EEGReading>): Observable<EEGSample> {
    const buffer: EEGReading[] = [];
    let lastTimestamp: number | null = null;
    return eegReadings.pipe(
        mergeMap((reading) => {
            if (reading.timestamp !== lastTimestamp) {
                lastTimestamp = reading.timestamp;
                if (buffer.length) {
                    const result = from([[...buffer]]);
                    buffer.splice(0, buffer.length, reading);
                    return result;
                }
            }
            buffer.push(reading);
            return from([]);
        }),
        concatWith(from([buffer])),
        mergeMap((readings: EEGReading[]) => {
            // Detect number of channels from the readings (standard Muse: 5, Athena: 8)
            const numChannels = Math.max(...readings.map((r) => r.electrode)) + 1;
            const result = readings[0].samples.map((x, index) => {
                const data = new Array(numChannels).fill(NaN);
                for (const reading of readings) {
                    data[reading.electrode] = reading.samples[index];
                }
                return {
                    data,
                    index: readings[0].index,
                    timestamp: readings[0].timestamp + (index * 1000) / EEG_FREQUENCY,
                };
            });
            return from(result);
        }),
    );
}
