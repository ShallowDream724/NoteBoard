/* global document, requestAnimationFrame, performance, window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert(process.env.NOTEBOARD_TEST_CDP, 'Use an isolated native QA launch');
const browser = await chromium.connectOverCDP(process.env.NOTEBOARD_TEST_CDP);
const context = browser.contexts()[0], page = context.pages().find(page => !page.url().startsWith('devtools:'));
const report = { errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const prose = page.locator('.nb-prose.ProseMirror[contenteditable="true"]').last();
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const session = await context.newCDPSession(page);
await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const memory = async () => {
  await session.send('HeapProfiler.collectGarbage');
  // Blink releases transient DOM asynchronously. Measure the settled state,
  // after hover timers and protocol element handles have finished releasing.
  await page.waitForTimeout(350); await session.send('HeapProfiler.collectGarbage');
  return { ...(await session.send('Runtime.getHeapUsage')), ...(await session.send('Memory.getDOMCounters')) };
};
try {
  const markdown = Array.from({ length: 1000 }, (_, index) => `${index + 1}. row-${index + 1}`).join('\n') + '\n\ndrag source\n';
  const started = performance.now();
  await prose.evaluate((element, markdown) => element.editor.commands.setContent(markdown, { contentType: 'markdown' }), markdown);
  await frames(); report.loadMs = performance.now() - started;
  assert.equal(await prose.locator('ol > li').count(), 1000);
  async function gesture() {
    await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await frames();
    const source = prose.locator('p').filter({ hasText: /^drag source$/ }); await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox(); await page.mouse.move(sourceBox.x + 35, sourceBox.y + 10); await frames();
    const handle = page.locator('.nb-block-drag-handle'); await handle.waitFor();
    const element = await source.elementHandle();
    try { const ready = await page.waitForFunction(source => {
      const handle = document.querySelector('.nb-block-drag-handle'); if (!handle) return false;
      const target = source.getBoundingClientRect(), control = handle.getBoundingClientRect();
      return Math.abs(control.y + control.height / 2 - (target.y + Math.min(15, target.height / 2))) < 22;
    }, element); await ready.dispose(); } finally { await element?.dispose(); }
    const handleBox = await handle.boundingBox();
    const lastBox = await prose.locator('ol > li').last().boundingBox();
    await page.mouse.move(handleBox.x + 8, handleBox.y + 10); await page.mouse.down();
    await page.mouse.move(lastBox.x + 40, lastBox.y + 5, { steps: 3 }); await frames();
    assert(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')));
    await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
    assert.equal(await prose.evaluate(element => element.classList.contains('nb-editor-dragging')), false);
    assert.equal(await page.locator('.nb-block-drop-indicator').count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.cursor), '');
  }
  await gesture(); report.before = await memory();
  const latencies = [];
  for (let index = 0; index < 20; index++) {
    await gesture();
    latencies.push(await page.evaluate(() => { const start = performance.now(); return new Promise(resolve => window.setTimeout(() => resolve(performance.now() - start), 0)); }));
  }
  report.after = await memory(); report.cancelledGestures = 20; report.responseMs = latencies;
  assert.equal(await prose.locator('ol > li').count(), 1000);
  assert(report.after.usedSize - report.before.usedSize < 3 * 1024 * 1024, 'Cancelled gestures retain bounded heap');
  assert(report.after.nodes <= report.before.nodes, 'Cancelled gestures release transient DOM');
  assert(report.after.jsEventListeners <= report.before.jsEventListeners, 'Gesture listeners do not accumulate');
  await page.screenshot({ path: '.tmp/interaction-followup/native/thousand-list.png' });
  await prose.evaluate(element => {
    const editor = element.editor, list = editor.state.doc.firstChild;
    editor.commands.setTextSelection({ from: 3, to: 1 + list.content.size - 2 }); editor.view.focus();
  }); await frames();
  async function batchGesture() {
    await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await frames();
    const first = prose.locator('ol > li').first(); await first.scrollIntoViewIfNeeded();
    const box = await first.boundingBox(); await page.mouse.move(box.x + 35, box.y + 10); await frames();
    const handle = page.locator('.nb-block-drag-handle'); await handle.waitFor();
    assert.equal(await handle.getAttribute('aria-label'), '拖动1000 个内容块');
    const control = await handle.boundingBox();
    const markup = await prose.innerHTML();
    const start = performance.now();
    await page.mouse.move(control.x + control.width / 2, control.y + control.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 45, { steps: 3 }); await frames();
    assert.equal(await page.locator('.nb-block-drag-source-feedback').count(), 1);
    assert.equal(await prose.locator('.nb-block-drag-source').count(), 0, 'Drag feedback never mutates editable rows');
    assert.equal(await prose.innerHTML(), markup, 'Source feedback leaves ProseMirror-managed DOM unchanged');
    await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
    assert.equal(await prose.locator('.nb-block-drag-source').count(), 0);
    assert.equal(await page.locator('.nb-block-drag-source-feedback').count(), 0);
    assert.equal(await page.locator('.nb-block-drop-indicator').count(), 0);
    return performance.now() - start;
  }
  await batchGesture(); report.batch = { items: 1000, gestures: 10, before: await memory(), gestureMs: [] };
  for (let index = 0; index < 10; index++) report.batch.gestureMs.push(await batchGesture());
  report.batch.after = await memory();
  assert(report.batch.after.usedSize - report.batch.before.usedSize < 3 * 1024 * 1024, 'Batch plans release retained heap');
  assert(report.batch.after.nodes <= report.batch.before.nodes + 10, 'Batch range feedback uses bounded DOM');
  assert(report.batch.after.jsEventListeners <= report.batch.before.jsEventListeners + 10, 'Batch listeners do not accumulate');
  await prose.evaluate(element => {
    const editor = element.editor;
    const paragraph = (text, heading = false) => ({ type: heading ? 'heading' : 'paragraph', attrs: { ...(heading ? { level: 2 } : {}), textAlign: 'right', blockBackground: '#ffeecc', blockTextColor: '#aa0000' }, content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] });
    editor.commands.setContent({ type: 'doc', content: [{ type: 'table', attrs: { tableAlign: 'right' }, content: Array.from({ length: 1000 }, (_, row) => ({ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { background: '#dcfce7' }, content: [paragraph(`row-${row + 1}`, true)] },
      { type: 'tableCell', content: [paragraph(`keep-${row + 1}`)] },
    ] })) }, paragraph('after')] });
    const cells = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[cells.length - 2] }); editor.view.focus();
  }); await frames();
  const tableCycle = async () => {
    const times = [];
    for (const action of ['clear', 'restore']) {
      const start = performance.now(); await page.keyboard.press(action === 'clear' ? 'Control+Backslash' : 'Control+0'); await frames(); times.push(performance.now() - start);
      await prose.evaluate((element, action) => {
        const editor = element.editor, table = editor.state.doc.firstChild;
        if (table.childCount !== 1000 || table.attrs.tableAlign !== 'right') throw new Error('Table grid/placement changed');
        for (let row = 0; row < 1000; row++) {
          const line = table.child(row), target = line.firstChild.firstChild;
          if (line.child(1).firstChild.textContent !== `keep-${row + 1}` || line.firstChild.attrs.background !== '#dcfce7') throw new Error('Unselected cell or fill changed');
          if (action === 'clear' ? target.attrs.textAlign !== null || target.firstChild.marks.length : target.type.name !== 'paragraph' || target.attrs.textAlign !== 'right') throw new Error('Wrong reset scope');
        }
        if (editor.state.selection.toJSON().type !== 'cell') throw new Error('Cell selection lost');
      }, action); await frames();
      // The application owns document history. Native PM undo would be recorded
      // as another edit in that timeline and deliberately retain those edits.
      await page.keyboard.press('Control+z'); await frames();
      await prose.evaluate(element => {
        const editor = element.editor, table = editor.state.doc.firstChild;
        if (table.childCount !== 1000 || table.child(0).firstChild.firstChild.type.name !== 'heading'
          || !table.child(0).firstChild.firstChild.firstChild.marks.some(mark => mark.type.name === 'bold'))
          throw new Error('Application undo failed to restore table content');
        // Shared document-history navigation restores a caret; the next bulk
        // edit selects the same column through the normal selection command.
        const cells = []; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
        editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[cells.length - 2] }); editor.view.focus();
      }); await frames();
    }
    return times;
  };
  await tableCycle();
  report.table = { rows: 1000, before: await memory(), cycles: 10, actionMs: [] };
  for (let index = 0; index < 10; index++) report.table.actionMs.push(await tableCycle());
  report.table.after = await memory();
  assert(report.table.after.usedSize - report.table.before.usedSize < 10 * 1024 * 1024, 'Repeated table resets retain bounded heap');
  assert(report.table.after.nodes <= report.table.before.nodes + 10, 'Table reset controls do not accumulate DOM');
  assert(report.table.after.jsEventListeners <= report.table.before.jsEventListeners + 10, 'Table reset listeners do not accumulate');
  await page.screenshot({ path: '.tmp/interaction-followup/native/thousand-table.png' });
  assert.equal(report.errors.length, 0); report.passed = true;
} finally {
  await fs.writeFile('.tmp/interaction-followup/native/drag-memory.json', JSON.stringify(report, null, 2));
  await session.detach(); await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, heapGrowthBytes: report.after.usedSize - report.before.usedSize }));
