import { encodeCommand } from './muse-utils';

import { TextDecoder as UtilTextDecoder, TextEncoder as UtilTextEncoder } from 'node:util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare var global: any;
if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = UtilTextEncoder as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = UtilTextDecoder as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('encodeCommand', () => {
    it('should correctly encode the given command as a Uint8Array', () => {
        expect(encodeCommand('v1')).toEqual(new Uint8Array([3, 118, 49, 10]));
    });
});
