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
    const point: GraphPoint = {
        index: reading.index,
        timestamp: reading.timestamp,
    };

    reading.samples.forEach((sample, index) => {
        point[`ch${index}`] = sample;
    });

    return [...points, point].slice(-maxPoints);
}

export function buildVisibleChannels(channelNames: readonly string[]): boolean[] {
    return channelNames.map(() => true);
}

export function deriveOpticalChannelNames(channelCount: number, labels: readonly string[]): string[] {
    return labels.slice(0, channelCount);
}
