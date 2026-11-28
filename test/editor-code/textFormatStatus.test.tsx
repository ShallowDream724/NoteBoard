import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TextFormatStatus } from '../../src/components/statusbar/TextFormatStatus';
import { useDocumentStore, type Document } from '../../src/stores/documentStore';
import { changeFileEol, reopenFileWithEncoding, saveFileWithEncoding } from '../../src/features/editor-code/orchestration/textFileFormat';

vi.mock('../../src/features/editor-code/orchestration/textFileFormat', () => ({
  changeFileEol: vi.fn().mockResolvedValue(true),
  reopenFileWithEncoding: vi.fn().mockResolvedValue(true),
  saveFileWithEncoding: vi.fn().mockResolvedValue(true),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let doc: Document;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  doc = useDocumentStore.getState().upsertFromPayload({ key: 'example.py', displayName: 'example.py', dirPath: '',
    kind: 'code', language: 'python', content: 'pass', encoding: 'utf8', eol: 'crlf', readonly: false, mtime: 1, size: 4 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useDocumentStore.getState().clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function keyDown(element: Element, key: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}

it('checks the current ending and changes it for the displayed file', async () => {
  await act(async () => root.render(<TextFormatStatus doc={doc} detached={false} />));
  await keyDown(host.querySelector('[aria-label="行尾符：CRLF"]')!, 'Enter');
  expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toBe('CRLF');
  const lf = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(row => row.textContent === 'LF')!;
  await act(async () => lf.click());
  expect(changeFileEol).toHaveBeenCalledWith(doc.key, 'lf');
});

it.each([
  ['通过编码重新打开', reopenFileWithEncoding, saveFileWithEncoding],
  ['通过编码保存', saveFileWithEncoding, reopenFileWithEncoding],
] as const)('dispatches only the chosen encoding operation for %s', async (label, selected, other) => {
  await act(async () => root.render(<TextFormatStatus doc={doc} detached={false} />));
  await keyDown(host.querySelector('[aria-label="文件编码：UTF-8"]')!, 'Enter');
  const sub = Array.from(document.querySelectorAll('[role="menuitem"]')).find(row => row.textContent === label)!;
  await keyDown(sub, 'ArrowRight');
  expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toBe('UTF-8');
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(row => row.textContent?.includes('GB18030'))!;
  await act(async () => target.click());
  expect(selected).toHaveBeenCalledWith(doc.key, 'gb18030');
  expect(other).not.toHaveBeenCalled();
});
