/**
 * Async Relay Worker — handles encoding/decoding off the main thread.
 *
 * Operates in one of two modes:
 *
 * LEADER MODE (primary tab):
 *   - Communicates with own sync-relay via asyncSAB (SharedArrayBuffer)
 *   - Uses Atomics.wait to block until sync-relay writes response
 *   - No MessagePort hop — direct SAB-based communication
 *
 * FOLLOWER MODE (secondary tabs):
 *   - Communicates with leader's sync-relay via MessagePort
 *   - Same protocol as current server port communication
 *   - Port is obtained through service worker tab discovery
 *
 * Both modes encode requests the same way (binary protocol) and decode
 * responses the same way. Only the transport differs.
 */

import {
  SAB_OFFSETS, SIGNAL,
  encodeRequest, encodeTwoPathRequest, decodeResponse,
  OP,
} from '../protocol/opcodes.js';

const encoder = new TextEncoder();
const HEADER_SIZE = SAB_OFFSETS.HEADER_SIZE;

// ========== Leader mode: asyncSAB communication ==========

let asyncSab: SharedArrayBuffer | null = null;
let asyncCtrl: Int32Array | null = null;

// Wake hint: sync-relay's SAB ctrl — notify to wake leader loop immediately
let wakeCtrl: Int32Array | null = null;

/**
 * Send a request via asyncSAB and block until response (leader mode).
 */
function sabRequest(requestBuf: ArrayBuffer): { status: number; data: Uint8Array | null } {
  const maxChunk = asyncSab!.byteLength - HEADER_SIZE;
  const requestBytes = new Uint8Array(requestBuf);
  const totalLenView = new BigUint64Array(asyncSab!, SAB_OFFSETS.TOTAL_LEN, 1);

  // Write request to asyncSAB
  if (requestBytes.byteLength <= maxChunk) {
    // Fast path: single chunk
    new Uint8Array(asyncSab!, HEADER_SIZE, requestBytes.byteLength).set(requestBytes);
    Atomics.store(asyncCtrl!, 3, requestBytes.byteLength);
    Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
    Atomics.store(asyncCtrl!, 0, SIGNAL.REQUEST);
    Atomics.notify(asyncCtrl!, 0);
    // Wake the leader loop (which waits on syncSAB's ctrl, not asyncCtrl)
    if (wakeCtrl) Atomics.notify(wakeCtrl, 0);
  } else {
    // Multi-chunk request
    let sent = 0;
    while (sent < requestBytes.byteLength) {
      const chunkSize = Math.min(maxChunk, requestBytes.byteLength - sent);
      new Uint8Array(asyncSab!, HEADER_SIZE, chunkSize).set(
        requestBytes.subarray(sent, sent + chunkSize)
      );
      Atomics.store(asyncCtrl!, 3, chunkSize);
      Atomics.store(totalLenView, 0, BigInt(requestBytes.byteLength));
      Atomics.store(asyncCtrl!, 6, Math.floor(sent / maxChunk));

      if (sent === 0) {
        Atomics.store(asyncCtrl!, 0, SIGNAL.REQUEST);
      } else {
        Atomics.store(asyncCtrl!, 0, SIGNAL.CHUNK);
      }
      Atomics.notify(asyncCtrl!, 0);
      // Wake leader loop on first chunk
      if (sent === 0 && wakeCtrl) Atomics.notify(wakeCtrl, 0);

      sent += chunkSize;
      if (sent < requestBytes.byteLength) {
        // Wait for sync-relay to ack chunk
        Atomics.wait(asyncCtrl!, 0, sent === chunkSize ? SIGNAL.REQUEST : SIGNAL.CHUNK);
      }
    }
  }

  // Wait for response from sync-relay
  Atomics.wait(asyncCtrl!, 0, SIGNAL.REQUEST);

  // Read response (may be multi-chunk)
  const signal = Atomics.load(asyncCtrl!, 0);
  const respChunkLen = Atomics.load(asyncCtrl!, 3);
  const respTotalLen = Number(Atomics.load(totalLenView, 0));

  let responseBytes: Uint8Array;

  if (signal === SIGNAL.RESPONSE && respTotalLen <= maxChunk) {
    // Single chunk response
    responseBytes = new Uint8Array(asyncSab!, HEADER_SIZE, respChunkLen).slice();
  } else {
    // Multi-chunk response
    responseBytes = new Uint8Array(respTotalLen);
    let received = 0;

    responseBytes.set(new Uint8Array(asyncSab!, HEADER_SIZE, respChunkLen), 0);
    received += respChunkLen;

    while (received < respTotalLen) {
      Atomics.store(asyncCtrl!, 0, SIGNAL.CHUNK_ACK);
      Atomics.notify(asyncCtrl!, 0);
      Atomics.wait(asyncCtrl!, 0, SIGNAL.CHUNK_ACK);

      const nextLen = Atomics.load(asyncCtrl!, 3);
      responseBytes.set(new Uint8Array(asyncSab!, HEADER_SIZE, nextLen), received);
      received += nextLen;
    }
  }

  // Reset to IDLE and notify sync-relay so it can proceed
  Atomics.store(asyncCtrl!, 0, SIGNAL.IDLE);
  Atomics.notify(asyncCtrl!, 0);

  return decodeResponse(responseBytes.buffer as ArrayBuffer);
}

// ========== Follower mode: MessagePort communication ==========

let leaderPort: MessagePort | null = null;
const pending = new Map<string, (response: ArrayBuffer) => void>();
let requestId = 0;

function nextId(): string {
  return 'a' + (requestId++);
}

function portRequest(buffer: ArrayBuffer): Promise<{ status: number; data: Uint8Array | null }> {
  return new Promise(resolve => {
    const id = nextId();
    pending.set(id, (respBuf) => {
      resolve(decodeResponse(respBuf));
    });
    leaderPort!.postMessage({ id, buffer }, [buffer]);
  });
}

// ========== Unified request dispatch ==========

async function sendRequest(reqBuffer: ArrayBuffer): Promise<{ status: number; data: Uint8Array | null }> {
  if (asyncSab) {
    // Leader mode: SAB-based (synchronous in worker, wrapped in promise for uniform API)
    return sabRequest(reqBuffer);
  } else if (leaderPort) {
    // Follower mode: MessagePort-based
    return portRequest(reqBuffer);
  }
  return { status: 7, data: null }; // EINVAL — no channel
}

// ========== Main thread message handling ==========

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  // --- Leader mode init ---
  if (msg.type === 'init-leader') {
    asyncSab = msg.asyncSab;
    asyncCtrl = new Int32Array(msg.asyncSab, 0, 8);
    if (msg.wakeSab) {
      wakeCtrl = new Int32Array(msg.wakeSab, 0, 1);
    }
    return;
  }

  // --- Follower mode init ---
  if (msg.type === 'init-follower') {
    // Nothing to do yet — port arrives separately
    return;
  }

  // --- Leader port (follower mode) ---
  if (msg.type === 'leader-port') {
    leaderPort = msg.port;
    leaderPort!.onmessage = (ev: MessageEvent) => {
      const { id, buffer } = ev.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(buffer);
      }
    };
    leaderPort!.start();
    return;
  }

  // --- Handle async fs operation request from main thread ---
  if (msg.type === 'request') {
    const { callId, op, path, data, flags, path2, fdArgs } = msg;

    try {
      let reqBuffer: ArrayBuffer;

      // Encode request based on operation type
      if (path2 !== undefined) {
        // Two-path operations (rename, copy, symlink, link)
        reqBuffer = encodeTwoPathRequest(op, path, path2, flags ?? 0);
      } else if (fdArgs) {
        // File descriptor operations
        reqBuffer = encodeFdRequest(op, fdArgs);
      } else {
        // Standard single-path operations
        const encodedData = encodeData(data);
        reqBuffer = encodeRequest(op, path ?? '', flags ?? 0, encodedData ?? undefined);
      }

      const { status, data: respData } = await sendRequest(reqBuffer);

      (self as unknown as Worker).postMessage(
        { type: 'response', callId, status, data: respData },
        respData ? [respData.buffer] : []
      );
    } catch (err) {
      (self as unknown as Worker).postMessage({
        type: 'response',
        callId,
        status: 7, // EINVAL
        data: null,
        error: (err as Error).message,
      });
    }
  }
};

// ========== Encoding helpers ==========

function encodeData(data: unknown): Uint8Array | null {
  if (data === null || data === undefined) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return encoder.encode(data);
  return null;
}

function encodeFdRequest(op: number, args: { fd: number; length?: number; position?: number; data?: Uint8Array }): ArrayBuffer {
  switch (op) {
    case OP.FREAD: {
      const buf = new Uint8Array(12);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setUint32(4, args.length ?? 0, true);
      view.setInt32(8, args.position ?? -1, true);
      return encodeRequest(op, '', 0, buf);
    }
    case OP.FWRITE: {
      const writeData = args.data ?? new Uint8Array(0);
      const buf = new Uint8Array(8 + writeData.byteLength);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setInt32(4, args.position ?? -1, true);
      buf.set(writeData, 8);
      return encodeRequest(op, '', 0, buf);
    }
    case OP.FSTAT:
    case OP.CLOSE: {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, args.fd, true);
      return encodeRequest(op, '', 0, buf);
    }
    case OP.FTRUNCATE: {
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer);
      view.setUint32(0, args.fd, true);
      view.setUint32(4, args.length ?? 0, true);
      return encodeRequest(op, '', 0, buf);
    }
    case OP.FSYNC:
      return encodeRequest(op, '', 0);
    default:
      return encodeRequest(op, '', 0);
  }
}
