export * from './muse';
export {
    MuseAthenaClient,
    ATHENA_COMMANDS,
    ATHENA_PRESETS,
    opticalChannelNames,
    channelNames as athenaChannelNames,
} from './muse-athena';
export type { AthenaPreset } from './muse-athena';
export * from './lib/muse-interfaces';
export { zipSamples } from './lib/zip-samples';
export { zipSamplesPpg } from './lib/zip-samplesPpg';
export type { EEGSample } from './lib/zip-samples';
export type { PPGSample } from './lib/zip-samplesPpg';
