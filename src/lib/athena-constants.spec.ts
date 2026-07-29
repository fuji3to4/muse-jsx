import {
    MUSE_ATHENA_EEG_SCALE_FACTOR,
    MUSE_ATHENA_ACC_SCALE_FACTOR,
    MUSE_ATHENA_GYRO_SCALE_FACTOR,
    MUSE_ATHENA_OPTICS_SCALE_FACTOR,
    MUSE_ATHENA_BATTERY_SCALE_FACTOR,
    PACKET_HEADER_SIZE,
    SUBPACKET_HEADER_SIZE,
} from './athena-constants';

describe('athena-constants', () => {
    it("matches BrainFlow's muse_athena_constants.h scale factors", () => {
        expect(MUSE_ATHENA_EEG_SCALE_FACTOR).toBe(0.0885);
        expect(MUSE_ATHENA_ACC_SCALE_FACTOR).toBe(0.00006103515625);
        expect(MUSE_ATHENA_GYRO_SCALE_FACTOR).toBe(-0.007476806640625);
        expect(MUSE_ATHENA_OPTICS_SCALE_FACTOR).toBe(0.00003051757813);
        expect(MUSE_ATHENA_BATTERY_SCALE_FACTOR).toBe(1 / 512);
    });

    it("matches BrainFlow's muse_athena.h packet framing sizes", () => {
        expect(PACKET_HEADER_SIZE).toBe(14);
        expect(SUBPACKET_HEADER_SIZE).toBe(5);
    });
});
