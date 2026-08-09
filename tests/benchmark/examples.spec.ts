/**
 * The examples have to actually run.
 *
 * A broken example is worse than none: it is the first thing a new user executes, and when it
 * fails they conclude the library does not work. These load each static example in a real
 * browser under the same COOP/COEP headers `examples/serve.js` sets, and assert that the page
 * reached its final line with no console error and no unhandled rejection.
 *
 * Run: npx playwright test examples --project=chromium
 */
import { test, expect } from './fixtures';

/** The examples served by `examples/serve.js`; the Vite one needs its own install. */
const STATIC_EXAMPLES = [
  { dir: '01-quickstart', done: /Done\. Everything above persisted/ },
  { dir: '02-files-and-streams', done: /Done\./ },
];

for (const { dir, done } of STATIC_EXAMPLES) {
  test(`example ${dir} runs clean`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

    await page.goto(`/examples/${dir}/`);
    await expect(page.locator('#out')).toContainText(done, { timeout: 60_000 });

    const text = await page.locator('#out').innerText();
    expect(text, 'example output').not.toContain('Serve with COOP/COEP');
    expect(problems, `${dir} produced errors:\n${problems.join('\n')}`).toEqual([]);
  });
}

test('example 03-worker-hosted mounts and writes from the worker', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/examples/03-worker-hosted/');
  await expect(page.locator('#out')).toContainText('worker ready', { timeout: 60_000 });

  await page.click('#write');
  await expect(page.locator('#out')).toContainText('1 line(s)', { timeout: 30_000 });
  await page.click('#write');
  await expect(page.locator('#out')).toContainText('2 line(s)', { timeout: 30_000 });

  expect(problems, problems.join('\n')).toEqual([]);
});

test('example 02 keeps a multi-byte character whole across a chunk boundary', async ({ page }) => {
  await page.goto('/examples/02-files-and-streams/');
  await expect(page.locator('#out')).toContainText(/Done\./, { timeout: 60_000 });
  const text = await page.locator('#out').innerText();
  // The line the streams fix exists for.
  expect(text).toMatch(/é intact: true, no U\+FFFD: true/);
  expect(text).toContain('latin1 bytes       [233]');
});
