import type { AthenaOpticalReading } from 'muse-jsx';

export type GraphPoint = {
    index: number;
    timestamp: number;
    [key: string]: number;
};

export function appendOpticalReading(
    points: GraphPoint[],
    reading: AthenaOpticalReading,
    maxPoints: number,
): GraphPoint[] {
    const nextPoint: GraphPoint = {
        index: reading.index,
        timestamp: reading.timestamp,
    };

    reading.samples.forEach((value, channelIndex) => {
        nextPoint[`ch${channelIndex}`] = value;
    });

    const nextPoints = [...points, nextPoint];
    return nextPoints.slice(-maxPoints);
}

export function buildVisibleChannels(channelNames: string[]): boolean[] {
    return channelNames.map(() => true);
}
