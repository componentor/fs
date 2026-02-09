/**
 * Shared types for method implementations.
 * Each method file imports this context type to access sync/async request primitives.
 */

export type SyncRequestFn = (buf: ArrayBuffer) => { status: number; data: Uint8Array | null };

export type AsyncRequestFn = (
  op: number,
  path: string,
  flags?: number,
  data?: Uint8Array | string | null,
  path2?: string,
  fdArgs?: Record<string, unknown>
) => Promise<{ status: number; data: Uint8Array | null }>;

export interface MethodContext {
  syncRequest: SyncRequestFn;
  asyncRequest: AsyncRequestFn;
  ensureReady: () => void;
}
