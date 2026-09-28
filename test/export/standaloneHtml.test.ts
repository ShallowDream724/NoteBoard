// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { standaloneHtml } from '../../src/features/export/standaloneHtml';
import { standaloneEnhancement } from '../../src/features/export/standaloneEnhancement';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

it('keeps the filename in browser metadata without injecting it into the document', async () => {
  const page = new DOMParser().parseFromString(await standaloneHtml('<article><h1>作者标题</h1></article>', '欢迎使用 NoteBoard.nb'), 'text/html');
  expect(page.title).toBe('欢迎使用 NoteBoard.nb');
  expect(page.body.textContent).toContain('作者标题');
  expect(page.body.textContent).not.toContain('欢迎使用 NoteBoard.nb');
  expect(page.querySelector('[data-page-download]')).not.toBeNull();
});

it('downloads a complete local copy without using the file URL', async () => {
  document.title = '研究/笔记';
  document.body.innerHTML = '<nav><button data-page-download>保存副本</button></nav><div id="document"><p>正文</p></div>';
  const createObjectURL = vi.fn().mockReturnValue('blob:copy');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('研究_笔记.html');
    expect(this.href).toBe('blob:copy');
  });
  new Function(standaloneEnhancement)();
  document.querySelector<HTMLButtonElement>('[data-page-download]')!.click();
  expect(click).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  const copied = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
  expect(copied).toContain('<!doctype html>');
  expect(copied).toContain('<p>正文</p>');
  expect(copied).not.toContain('export-image-dialog');
});
