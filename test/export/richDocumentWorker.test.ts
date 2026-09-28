// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('exports standalone rich HTML from a native snapshot without Pandoc or desktop asset URLs', async () => {
  const postMessage = vi.fn((message: { type: string; paths?: string[]; result?: string }) => {
    if (message.type === 'assets') void scope.onmessage!({ data: { type: 'asset-urls', urls: message.paths!.map((_, index) => `data:image/png;base64,aW1hZ2Ut${index}`) } });
  });
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 1, 2]))));
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await import('../../src/features/export/documentWorker');
  await scope.onmessage!({ data: { type: 'convert', format: 'standalone-html', title: 'Rich export', directory: 'C:/Notes', markdown: {
    type: 'doc', content: [
      { type: 'documentPresentation', attrs: { tableStyle: 'three-line' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Anchor', marks: [{ type: 'annotationReference', attrs: { id: 'a' } }] }] },
      { type: 'mathBlock', attrs: { latex: String.raw`\frac{a}{b}`, textAlign: 'left' } },
      { type: 'imageCollection', attrs: { layout: 'carousel', columns: 2 }, content: [
        { type: 'imageSlot', content: [{ type: 'image', attrs: { src: 'img/a #1.png', alt: 'First' } }] },
        { type: 'imageSlot', content: [{ type: 'image', attrs: { src: 'file:///C:/Notes/%E4%B8%AD%E6%96%87%20b.png', alt: 'Second' } }] },
      ] },
      { type: 'image', attrs: { src: 'https://example.com/remote.png', alt: 'Remote' } },
      { type: 'image', attrs: { src: 'data:image/gif;base64,R0lGODlh', alt: 'Embedded' } },
      { type: 'disclosure', attrs: { title: 'Closed', open: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whole body', marks: [{ type: 'conceal' }] }] }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] },
      ] },
      { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whole note' }] }] }] },
    ],
  } } });
  const message = postMessage.mock.calls.at(-1)?.[0];
  expect(message?.type, JSON.stringify(message)).toBe('result');
  if (!message) throw new Error('Worker did not return a result');
  expect(message.result).toContain('<!doctype html>');
  expect(message.result).toContain('data:image/png;base64,aW1hZ2Ut0');
  expect(message.result).toContain('data:image/png;base64,aW1hZ2Ut1');
  expect(message.result).toContain('https://example.com/remote.png');
  expect(message.result).toContain('data:image/gif;base64,R0lGODlh');
  expect(message.result).not.toMatch(/file:\/\/\/|asset:\/\//);
  expect(message.result).toContain('export-image-carousel');
  expect(message.result).toContain('Whole body');
  expect(message.result).toContain('Whole note');
  expect(message.result).toContain('export-note-1');
  expect(message.result).toContain('data-export-edge="left top"');
  expect(message.result).toContain('data-export-edge="left bottom"');
  expect(message.result).toContain('class="export-table-scroll"');
  expect(message.result).toMatch(/<math[^>]+display="block"/);
  expect(message.result).toContain('data:font/woff2;base64,');
  expect(message.result).toContain('data-math-align="left"');
  expect(message.result).not.toContain('@import');
  expect(postMessage).toHaveBeenCalledWith({ type: 'assets', paths: ['C:\\Notes\\img\\a #1.png', 'C:\\Notes\\中文 b.png'] });
});
