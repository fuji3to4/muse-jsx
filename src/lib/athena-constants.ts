/**
 * Scale factors and packet framing sizes for the Muse Athena BLE protocol.
 * Mirrors BrainFlow's board_controller/muse/inc/muse_athena_constants.h and
 * muse_athena.h so they can be revised independently of parsing logic.
 */

// export const MUSE_ATHENA_EEG_SCALE_FACTOR = 0.40293040293040294; // ref. brainflow/board_controller/muse/inc/muse_athena_constants.h
export const MUSE_ATHENA_EEG_SCALE_FACTOR = 0.0885; // 1450 uV / 16383 LSB
export const MUSE_ATHENA_ACC_SCALE_FACTOR = 0.00006103515625;
export const MUSE_ATHENA_GYRO_SCALE_FACTOR = -0.007476806640625;
// export const MUSE_ATHENA_OPTICS_SCALE_FACTOR = 1.0;
export const MUSE_ATHENA_OPTICS_SCALE_FACTOR = 1 / 32768;
export const MUSE_ATHENA_BATTERY_SCALE_FACTOR = 1 / 512;

export const PACKET_HEADER_SIZE = 14;
export const SUBPACKET_HEADER_SIZE = 5;
