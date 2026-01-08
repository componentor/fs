// Type declarations for Atomics.waitAsync (ES2024)
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync

interface AtomicsWaitAsyncResult {
  async: true;
  value: Promise<'ok' | 'not-equal' | 'timed-out'>;
}

interface Atomics {
  /**
   * Verifies that a shared memory location still contains a given value and
   * if so sleeps, awaiting a wake-up notification or times out. Returns a
   * Promise. Unlike Atomics.wait(), waitAsync is non-blocking and usable
   * on the main thread.
   */
  waitAsync(
    typedArray: Int32Array,
    index: number,
    value: number,
    timeout?: number
  ): AtomicsWaitAsyncResult;
}
