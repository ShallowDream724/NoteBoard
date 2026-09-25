import { afterEach, expect, it, vi } from 'vitest';
import { waitForExportFonts } from '../../src/features/export/fontsReady';
const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => { vi.restoreAllMocks(); if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else Reflect.deleteProperty(document, 'fonts'); });

it('waits for the font loading promise created by the newly inserted document layout', async () => {
  let finish!: () => void;
  const loaded = new Promise<void>(resolve => { finish = resolve; });
  let laidOut = false;
  Object.defineProperty(document, 'fonts', { configurable: true, value: { get ready() { return laidOut ? loaded : Promise.resolve(); }, *[Symbol.iterator]() {} } });
  const root = document.createElement('div');
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => { laidOut = true; return new DOMRect(); });
  let printed = false; const pending = waitForExportFonts(root).then(() => { printed = true; });
  await Promise.resolve(); expect(printed).toBe(false);
  finish(); await pending; expect(printed).toBe(true);
});

it('reports failed requested fonts instead of silently printing fallback text', async () => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: Object.assign([{ family: 'Source Han Sans SC', status: 'error' }, { family: 'Unused', status: 'unloaded' }], { ready: Promise.resolve() }) });
  await expect(waitForExportFonts(document.createElement('div'))).rejects.toThrow('Source Han Sans SC');
});
