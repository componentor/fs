/**
 * OPFS-FS Benchmark Suite
 * Compares performance of OPFS-FS (all tiers) and VFS against LightningFS
 *
 * Run with: npm run benchmark
 */

import { test, expect } from '@playwright/test';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  fileSize: number;
  fileSizeMB?: number;
  lightning: number;
  tier1: number | null;
  tier1Promises: number | null;
  tier2: number | null;
  vfsSync: number | null;
  vfsPromises: number | null;
}

test.describe('OPFS-FS Benchmark Suite', () => {
  test.setTimeout(180000); // 3 minutes for all benchmarks

  test('Full benchmark comparison: OPFS vs LightningFS vs VFS', async ({ page }) => {
    // Navigate to benchmark page
    await page.goto('/');

    // Wait for page to load
    await page.waitForSelector('#btn-run-all');

    // Check environment
    const env = await page.evaluate(() => ({
      crossOriginIsolated: (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
      hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      hasAtomics: typeof Atomics !== 'undefined',
      hasOPFS: 'storage' in navigator,
    }));

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                   OPFS-FS BENCHMARK SUITE                        ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Cross-Origin Isolated: ${env.crossOriginIsolated ? '✅ Yes' : '❌ No (Tier 1 unavailable)'}`.padEnd(68) + '║');
    console.log(`║ SharedArrayBuffer:     ${env.hasSharedArrayBuffer ? '✅ Yes' : '❌ No'}`.padEnd(68) + '║');
    console.log(`║ Atomics:               ${env.hasAtomics ? '✅ Yes' : '❌ No'}`.padEnd(68) + '║');
    console.log(`║ OPFS Available:        ${env.hasOPFS ? '✅ Yes' : '❌ No'}`.padEnd(68) + '║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    // Run all benchmarks
    console.log('Running benchmarks...\n');
    await page.click('#btn-run-all');

    // Wait for benchmarks to complete (check for success status)
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 180000 }
    );

    // Get results
    const results: BenchmarkResult[] = await page.evaluate(() => {
      return (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults();
    });

    expect(results.length).toBeGreaterThan(0);

    // Print comparison table
    const formatMs = (ms: number | null, iterations: number) => {
      if (ms === null || ms === undefined) return 'N/A'.padStart(13);
      const opsPerSec = iterations > 0 ? Math.round(iterations / ms * 1000) : 0;
      return `${ms.toFixed(0).padStart(5)}ms ${opsPerSec.toString().padStart(5)}op/s`;
    };

    console.log('╔══════════════════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦═══════════════╦══════════════╗');
    console.log('║ Test                     ║ LightningFS   ║ T1 Sync       ║ T1 Promises   ║ Tier 2        ║ VFS Sync      ║ VFS Promises  ║ Winner       ║');
    console.log('╠══════════════════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬═══════════════╬══════════════╣');

    for (const result of results) {
      const testName = result.operation === 'write'
        ? `Write ${result.iterations}×${result.fileSize}B`
        : result.operation === 'read'
        ? `Read ${result.iterations}×${result.fileSize}B`
        : result.operation === 'large-write'
        ? `Large ${result.iterations}×${result.fileSizeMB}MB`
        : result.operation === 'batch-write'
        ? `Batch W ${result.iterations}×${result.fileSize}B`
        : result.operation === 'batch-read'
        ? `Batch R ${result.iterations}×${result.fileSize}B`
        : result.operation === 'git-clone'
        ? `Git Clone`
        : result.operation === 'git-status'
        ? `Git Status ${result.iterations}x`
        : `Unknown`;

      const values = [
        { name: 'LFS', ms: result.lightning },
        { name: 'T1 Sync', ms: result.tier1 },
        { name: 'T1 Prom', ms: result.tier1Promises },
        { name: 'T2', ms: result.tier2 },
        { name: 'VFS Sync', ms: result.vfsSync },
        { name: 'VFS Prom', ms: result.vfsPromises },
      ].filter(v => v.ms !== null && v.ms !== undefined) as { name: string; ms: number }[];

      const minMs = values.length > 0 ? Math.min(...values.map(v => v.ms)) : 0;
      const winner = values.find(v => v.ms === minMs);
      const speedup = winner && result.lightning ? (result.lightning / minMs).toFixed(1) : '-';
      const winnerDisplay = winner ? `${winner.name} ${speedup}x` : '-';

      console.log(
        `║ ${testName.padEnd(24)} ║ ${formatMs(result.lightning, result.iterations)} ║ ${formatMs(result.tier1, result.iterations)} ║ ${formatMs(result.tier1Promises, result.iterations)} ║ ${formatMs(result.tier2, result.iterations)} ║ ${formatMs(result.vfsSync, result.iterations)} ║ ${formatMs(result.vfsPromises, result.iterations)} ║ ${winnerDisplay.padEnd(12)} ║`
      );
    }

    console.log('╚══════════════════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩═══════════════╩══════════════╝');

    // Print bar chart
    console.log('\n📊 Performance Comparison (lower is better):\n');

    for (const result of results) {
      const testName = result.operation === 'write'
        ? `Write ${result.iterations}×${result.fileSize}B`
        : result.operation === 'read'
        ? `Read ${result.iterations}×${result.fileSize}B`
        : result.operation === 'large-write'
        ? `Large ${result.iterations}×${result.fileSizeMB}MB`
        : result.operation === 'batch-write'
        ? `Batch W ${result.iterations}×${result.fileSize}B`
        : result.operation === 'batch-read'
        ? `Batch R ${result.iterations}×${result.fileSize}B`
        : result.operation === 'git-clone'
        ? `Git Clone`
        : result.operation === 'git-status'
        ? `Git Status ${result.iterations}x`
        : `Unknown`;

      console.log(`${testName}:`);

      const allMs = [result.lightning, result.tier1, result.tier1Promises, result.tier2, result.vfsSync, result.vfsPromises].filter(v => v !== null && v !== undefined) as number[];
      const maxMs = Math.max(...allMs, 1);
      const scale = 50;

      const drawBar = (name: string, ms: number | null, emoji: string) => {
        if (ms === null || ms === undefined) {
          console.log(`  ${emoji} ${name.padEnd(14)} N/A`);
          return;
        }
        const barLen = Math.round((ms / maxMs) * scale);
        const bar = '█'.repeat(barLen) + '░'.repeat(scale - barLen);
        const opsPerSec = result.iterations > 0 ? Math.round(result.iterations / ms * 1000) : 0;
        console.log(`  ${emoji} ${name.padEnd(14)} ${bar} ${ms.toFixed(0)}ms (${opsPerSec} ops/s)`);
      };

      drawBar('LightningFS', result.lightning, '🟡');
      drawBar('T1 Sync', result.tier1, '🟢');
      drawBar('T1 Promises', result.tier1Promises, '🩵');
      drawBar('Tier 2', result.tier2, '🔵');
      drawBar('VFS Sync', result.vfsSync, '🟣');
      drawBar('VFS Promises', result.vfsPromises, '🩷');
      console.log('');
    }
  });

  test('Individual: Write performance (1KB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-write');
    await page.click('#btn-run-write');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nWrite 1KB benchmark:`);
    console.log(`  LightningFS:   ${result.lightning.toFixed(2)}ms`);
    console.log(`  Tier 1 Sync:   ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  Tier 2:        ${result.tier2?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Sync:      ${result.vfsSync?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Promises:  ${result.vfsPromises?.toFixed(2) || 'N/A'}ms`);
  });

  test('Individual: Read performance (1KB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-read');
    await page.click('#btn-run-read');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nRead 1KB benchmark:`);
    console.log(`  LightningFS:   ${result.lightning.toFixed(2)}ms`);
    console.log(`  Tier 1 Sync:   ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  Tier 2:        ${result.tier2?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Sync:      ${result.vfsSync?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Promises:  ${result.vfsPromises?.toFixed(2) || 'N/A'}ms`);
  });

  test('Individual: Large file performance (1MB)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#btn-run-large');
    await page.click('#btn-run-large');

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.includes('complete'),
      { timeout: 60000 }
    );

    const results = await page.evaluate(() => (window as unknown as { getBenchmarkResults: () => BenchmarkResult[] }).getBenchmarkResults());
    expect(results.length).toBe(1);

    const result = results[0];
    console.log(`\nLarge file (1MB) benchmark:`);
    console.log(`  LightningFS:   ${result.lightning.toFixed(2)}ms`);
    console.log(`  Tier 1 Sync:   ${result.tier1?.toFixed(2) || 'N/A'}ms`);
    console.log(`  Tier 2:        ${result.tier2?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Sync:      ${result.vfsSync?.toFixed(2) || 'N/A'}ms`);
    console.log(`  VFS Promises:  ${result.vfsPromises?.toFixed(2) || 'N/A'}ms`);
  });
});
