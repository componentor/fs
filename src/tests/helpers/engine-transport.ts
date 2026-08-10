/**
 * A synchronous transport that drives a real {@link VFSEngine} in-process.
 *
 * The method layer (`src/methods/*`) only ever talks to a `syncRequest(buffer) => {status, data}`
 * function; in the browser that function crosses a SharedArrayBuffer to a worker. Here it calls
 * the engine directly, which lets tests exercise the **whole** stack — argument parsing, wire
 * encoding, engine semantics — inside Node, and diff the result against real `node:fs`.
 *
 * There is no second copy of the dispatch here: this calls `dispatchOp` — the same decoder the
 * server worker runs — so a payload layout that is wrong in production is wrong in these tests
 * too. That is the point. The bug that motivated this harness (TRUNCATE decoded as uint32) was
 * invisible precisely because the tests re-implemented the decoding they were checking.
 */

import { VFSEngine } from '../../src/vfs/engine.js';
import { VFSFileSystem } from '../../src/filesystem.js';
import { MockSyncHandle } from './mock-handle.js';
import { decodeRequest, encodeRequest, encodeTwoPathRequest } from '../../src/protocol/opcodes.js';
import {
  encodeFdPayload, encodeFreadPayload, encodeFwritePayload, encodeFtruncatePayload,
} from '../../src/protocol/payloads.js';
import { dispatchOp } from '../../src/protocol/dispatch.js';
import { OP } from '../../src/protocol/opcodes.js';
import type { SyncRequestFn, AsyncRequestFn } from '../../src/methods/context.js';

export interface Harness {
  engine: VFSEngine;
  /** The `syncRequest` the sync method layer expects. */
  request: SyncRequestFn;
  /**
   * The `asyncRequest` the promise/callback method layer expects.
   *
   * This reproduces `async-relay.worker.ts`'s request *shaping* — the three-way branch on
   * `path2` / `fdArgs` / plain data — because that shaping is where the async path can diverge
   * from the sync one. It shares the shared payload encoders and the shared dispatch with
   * production, so a layout bug shows up here too.
   */
  asyncRequest: AsyncRequestFn;
}

/** Build an engine plus the `syncRequest` function the method layer expects. */
export function createHarness(opts?: { umask?: number; uid?: number; gid?: number; strictPermissions?: boolean }): Harness {
  const engine = new VFSEngine();
  engine.init(new MockSyncHandle(0) as unknown as FileSystemSyncAccessHandle, opts);

  const request: SyncRequestFn = (buffer: ArrayBuffer) => {
    const { op, flags, path, data } = decodeRequest(buffer);
    const r = dispatchOp(engine, 'harness', op, flags, path, data);
    return { status: r.status, data: r.data ?? null };
  };

  const asyncRequest: AsyncRequestFn = async (op, path, flags, data, path2, fdArgs) => {
    let buffer: ArrayBuffer;
    if (path2 !== undefined) {
      buffer = encodeTwoPathRequest(op, path, path2, flags ?? 0);
    } else if (fdArgs) {
      buffer = encodeFdRequest(op, fdArgs as FdArgs);
    } else {
      const encoded =
        data instanceof Uint8Array ? data
        : typeof data === 'string' ? new TextEncoder().encode(data)
        : undefined;
      buffer = encodeRequest(op, path ?? '', flags ?? 0, encoded);
    }
    return request(buffer);
  };

  return { engine, request, asyncRequest };
}

interface FdArgs { fd: number; length?: number; position?: number; data?: Uint8Array }

/** Mirrors async-relay.worker.ts's encodeFdRequest, over the same shared payload encoders. */
function encodeFdRequest(op: number, args: FdArgs): ArrayBuffer {
  switch (op) {
    case OP.FREAD:
      return encodeRequest(op, '', 0, encodeFreadPayload(args.fd, args.length ?? 0, args.position ?? -1));
    case OP.FWRITE:
      return encodeRequest(op, '', 0, encodeFwritePayload(args.fd, args.position ?? -1, args.data ?? new Uint8Array(0)));
    case OP.FSTAT:
    case OP.CLOSE:
    case OP.FSYNC:
      return encodeRequest(op, '', 0, encodeFdPayload(args.fd));
    case OP.FTRUNCATE:
      return encodeRequest(op, '', 0, encodeFtruncatePayload(args.fd, args.length ?? 0));
    default:
      return encodeRequest(op, '', 0);
  }
}

/**
 * A `VFSFileSystem` whose transport is an in-process engine.
 *
 * `_sync` and `_async` are instance fields, so `Object.create` gives an object with every real
 * instance method and no constructor — no workers, no SharedArrayBuffer. Assigning the harness
 * transports makes the **whole instance API** run end to end in Node: `cpSync`, the callback
 * overloads, `mkdtempDisposableSync`, everything that composes other calls through `this`.
 *
 * That matters because instance-level methods were previously reachable only from a browser
 * spec, which is why `cp` shipped with the wrong error codes for so long.
 */
export function createFsHarness(opts?: { umask?: number; uid?: number; gid?: number }): {
  fs: VFSFileSystem;
  engine: VFSEngine;
} {
  const h = createHarness(opts);
  const fs = Object.create(VFSFileSystem.prototype) as VFSFileSystem;
  const promises = Object.create(promisesPrototype());
  Object.assign(promises, { _async: h.asyncRequest, _ns: 'harness' });
  Object.assign(fs, {
    _sync: h.request,
    _async: h.asyncRequest,
    promises,
    ns: 'harness',
    config: {},
    isReady: true,
  });
  return { fs, engine: h.engine };
}

let cachedPromisesProto: object | null = null;

/**
 * `VFSPromises` is not exported, so its prototype is reached through one throwaway instance.
 *
 * Constructing a `VFSFileSystem` needs a `Worker`; a no-op stand-in is enough because nothing is
 * ever posted to it — the instance exists only to hand over `Object.getPrototypeOf(fs.promises)`,
 * and is then discarded. Cached so the cost is paid once per test file.
 */
function promisesPrototype(): object {
  if (cachedPromisesProto) return cachedPromisesProto;
  class StubWorker {
    onmessage: unknown = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  (globalThis as Record<string, unknown>).Worker ??= StubWorker;
  const throwaway = new VFSFileSystem();
  cachedPromisesProto = Object.getPrototypeOf(throwaway.promises) as object;
  return cachedPromisesProto;
}
