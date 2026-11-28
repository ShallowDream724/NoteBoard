// Launch scripts/launch-native-qa.py with --open-path pointing to a local HTML
// fixture, then pass its .tmp/native-qa/<name>.json record and expected image count.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const [recordPath, count, tabName] = process.argv.slice(2);
const expected = Number(count);
if (!recordPath || !Number.isSafeInteger(expected) || expected < 1) {
  throw new Error('Expected a native QA launch record and the number of fixture images');
}
const { port } = JSON.parse(await readFile(recordPath, 'utf8'));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser.contexts()[0].pages().find(tab => !tab.url().startsWith('devtools:'));
  if (tabName) await page.getByRole('tab').filter({ hasText: tabName }).click();
  const frame = page.locator('iframe[title$=" HTML 预览"]').filter({ visible: true });
  const images = frame.contentFrame().locator('img');
  await images.first().waitFor({ state: 'attached' });
  assert.equal(await frame.getAttribute('sandbox'), '', 'Ordinary HTML must stay isolated');
  const broken = await images.evaluateAll(async nodes => {
    const failures = await Promise.all(nodes.map(async (image, index) => {
      image.loading = 'eager';
      try {
        await image.decode();
        if (image.naturalWidth > 0) return null;
      } catch { /* Report all failed images with stable source-order indices. */ }
      return index + 1;
    }));
    return failures.filter(index => index !== null);
  });
  assert.equal(await images.count(), expected);
  assert.deepEqual(broken, [], 'Images that did not decode in the WebView2 preview');
  console.log(`Decoded ${expected} images in the native HTML preview`);
} finally {
  await browser.close();
}
