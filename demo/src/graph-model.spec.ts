import type { AthenaOpticalReading } from 'muse-jsx';

import {
    appendOpticalReading,
    buildVisibleChannels,
    deriveOpticalChannelNames,
    getOpticalYAxisDomain,
    OPTICAL_Y_RANGE_DEFAULT,
    OPTICAL_Y_RANGE_MAX,
} from './graph-model';
import type { GraphPoint } from './graph-model';

describe('graph model', () => {
    it('caps optical history to the requested point count', () => {
        let points: GraphPoint[] = [];

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

    it('derives library-backed optical labels from the current sample width', () => {
        expect(deriveOpticalChannelNames(4, ['LO_NIR', 'RO_NIR', 'LO_IR', 'RO_IR'])).toEqual([
            'LO_NIR',
            'RO_NIR',
            'LO_IR',
            'RO_IR',
        ]);
        expect(deriveOpticalChannelNames(2, ['LO_NIR', 'RO_NIR', 'LO_IR', 'RO_IR'])).toEqual(['LO_NIR', 'RO_NIR']);
        expect(deriveOpticalChannelNames(0, ['LO_NIR'])).toEqual([]);
    });

    it('uses a zero-based optical y-axis with wider slider defaults', () => {
        expect(getOpticalYAxisDomain(OPTICAL_Y_RANGE_DEFAULT)).toEqual([0, 2]);
        expect(OPTICAL_Y_RANGE_DEFAULT).toBe(2);
        expect(OPTICAL_Y_RANGE_MAX).toBe(20);
    });
});
