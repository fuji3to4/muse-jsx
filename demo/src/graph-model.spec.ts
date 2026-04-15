import { appendOpticalReading, buildVisibleChannels } from './graph-model';
import type { AthenaOpticalReading } from '../../src/lib/muse-interfaces';

describe('graph model', () => {
    it('caps optical history to the requested point count', () => {
        let points: Array<{ index: number; timestamp: number; [key: string]: number }> = [];

        for (let index = 0; index < 5; index += 1) {
            const reading: AthenaOpticalReading = {
                index,
                opticalChannel: 0,
                timestamp: 1000 + index,
                samples: [index, index + 10, index + 20],
            };

            points = appendOpticalReading(points, reading, 3);
        }

        expect(points).toHaveLength(3);
        expect(points.map((point) => point.index)).toEqual([2, 3, 4]);
        expect(points[2]).toMatchObject({
            index: 4,
            timestamp: 1004,
            ch0: 4,
            ch1: 14,
            ch2: 24,
        });
    });

    it('defaults channel visibility to true', () => {
        expect(buildVisibleChannels(['LO_NIR', 'RO_NIR', 'LI_IR'])).toEqual([true, true, true]);
    });
});
