import { detectHostLittleEndian } from './capability-tier.js';

/** WebExtensions Native Messaging hard ceiling from extension -> host (1 MiB). */
export const MAX_EXTENSION_TO_HOST_BYTES = 1_048_576;
/** WebExtensions Native Messaging hard ceiling from host -> extension (64 MiB). */
export const MAX_HOST_TO_EXTENSION_BYTES = 64 * 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const HOST_LITTLE_ENDIAN = detectHostLittleEndian();

export interface DecodedNativeFrame {
  byteLength: number;
  payload: unknown;
  bytesConsumed: number;
}

/**
 * Encode a JSON-serializable payload using WebExtensions Native Messaging 32-bit byte-length prefix.
 * Uses UTF-8 byte length (not JS UTF-16 string length) per Chrome/Firefox Native Messaging specs.
 */
export function encodeNativeFrame(
  payload: unknown,
  maxBytes: number = MAX_EXTENSION_TO_HOST_BYTES,
): Uint8Array {
  const json = JSON.stringify(payload);
  if (json === undefined) {
    throw new Error('NATIVE_FRAME_UNSERIALIZABLE: payload cannot be undefined');
  }
  const body = textEncoder.encode(json);
  if (body.byteLength > maxBytes) {
    throw new Error(
      `NATIVE_FRAME_TOO_LARGE: UTF-8 byte length ${body.byteLength} exceeds ceiling ${maxBytes}`,
    );
  }
  const frame = new Uint8Array(4 + body.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, 4);
  view.setUint32(0, body.byteLength, HOST_LITTLE_ENDIAN);
  frame.set(body, 4);
  return frame;
}

/**
 * Decode one Native Messaging stdio frame from a binary buffer.
 */
export function decodeNativeFrame(
  frame: Uint8Array,
  maxBytes: number = MAX_HOST_TO_EXTENSION_BYTES,
): DecodedNativeFrame {
  if (frame.byteLength < 4) {
    throw new Error('NATIVE_FRAME_TRUNCATED: fewer than 4 header bytes');
  }
  const view = new DataView(frame.buffer, frame.byteOffset, 4);
  const byteLength = view.getUint32(0, HOST_LITTLE_ENDIAN);
  if (byteLength > maxBytes) {
    throw new Error(
      `NATIVE_FRAME_TOO_LARGE: declared byte length ${byteLength} exceeds ceiling ${maxBytes}`,
    );
  }
  const totalBytes = 4 + byteLength;
  if (frame.byteLength < totalBytes) {
    throw new Error(
      `NATIVE_FRAME_INCOMPLETE: expected ${byteLength} payload bytes, got ${frame.byteLength - 4}`,
    );
  }
  const bodySlice = frame.subarray(4, totalBytes);
  const jsonText = textDecoder.decode(bodySlice);
  return {
    byteLength,
    payload: JSON.parse(jsonText) as unknown,
    bytesConsumed: totalBytes,
  };
}
