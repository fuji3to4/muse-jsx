import { fromEvent } from 'rxjs';
import { map, takeUntil } from 'rxjs';

export function decodeResponse(bytes: Uint8Array) {
    return new TextDecoder().decode(bytes.subarray(1, 1 + bytes[0]));
}

export function encodeCommand(cmd: string) {
    const raw = new TextEncoder().encode(`X${cmd}\n`);
    // Normalize to a plain Uint8Array (avoids Buffer/subclass issues in some environments)
    const encoded = new Uint8Array(raw);
    encoded[0] = encoded.length - 1;
    return encoded;
}

export async function observableCharacteristic(characteristic: BluetoothRemoteGATTCharacteristic) {
    await characteristic.startNotifications();
    const disconnected = fromEvent(characteristic.service!.device, 'gattserverdisconnected');
    return fromEvent(characteristic, 'characteristicvaluechanged').pipe(
        takeUntil(disconnected),
        map((event: Event) => (event.target as BluetoothRemoteGATTCharacteristic).value as DataView),
    );
}
