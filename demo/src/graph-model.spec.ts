import type { AthenaOpticalReading } from 'muse-jsx';

import { appendOpticalReading, buildVisibleChannels, type GraphPoint } from './graph-model';

describe('graph-model', () => {
    it('caps optical graph history to the requested point count', () => {
        const readingA: AthenaOpticalReading = {
            index: 1,
            opticalChannel: 0,
            timestamp: 1000,
            samples: [0.1, 0.2, 0.3, 0.4],
        };
        const readingB: AthenaOpticalReading = {
            index: 2,
            opticalChannel: 0,
            timestamp: 1010,
            samples: [1.1, 1.2, 1.3, 1.4],
        };
        const readingC: AthenaOpticalReading = {
            index: 3,
            opticalChannel: 0,
            timestamp: 1020,
            samples: [2.1, 2.2, 2.3, 2.4],
        };

        let points: GraphPoint[] = [];
        points = appendOpticalReading(points, readingA, 2);
        points = appendOpticalReading(points, readingB, 2);
        points = appendOpticalReading(points, readingC, 2);

        expect(points).toHaveLength(2);
        expect(points[0]).toMatchObject({ index: 2, ch0: 1.1, ch3: 1.4 });
        expect(points[1]).toMatchObject({ index: 3, ch0: 2.1, ch3: 2.4 });
    });

    it('defaults optical channel visibility to true for every provided label', () => {
        expect(buildVisibleChannels(['LO_NIR', 'RO_NIR', 'LO_IR', 'RO_IR'])).toEqual([true, true, true, true]);
    });
});
