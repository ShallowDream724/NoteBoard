// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('exports standalone rich HTML from a native snapshot without Pandoc or desktop asset URLs', async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>) };
  vi.stubGlobal('self', scope);
  for (const name of ['window', 'document', 'DOMParser']) vi.stubGlobal(name, undefined);
  await import('../../src/features/export/documentWorker');
  await scope.onmessage!({ data: { type: 'convert', format: 'standalone-html', title: 'Rich export', directory: 'C:/Notes', markdown: {
    type: 'doc', content: [
      { type: 'documentPresentation', attrs: { tableStyle: 'three-line' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Anchor', marks: [{ type: 'annotationReference', attrs: { id: 'a' } }] }] },
      { type: 'imageCollection', attrs: { layout: 'carousel', columns: 2 }, content: [
        { type: 'imageSlot', content: [{ type: 'image', attrs: { src: 'img/a #1.png', alt: 'First' } }] },
        { type: 'imageSlot', content: [{ type: 'image', attrs: { src: 'img/b.png', alt: 'Second' } }] },
      ] },
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
  expect(message.result).toContain('<!doctype html>');
  expect(message.result).toContain('file:///C:/Notes/img/a%20%231.png');
  expect(message.result).toContain('export-image-carousel');
  expect(message.result).toContain('Whole body');
  expect(message.result).toContain('Whole note');
  expect(message.result).toContain('export-note-1');
  expect(message.result).toContain('data-export-edge="left top"');
  expect(message.result).toContain('data-export-edge="left bottom"');
  expect(message.result).toContain('display:block math');
  expect(postMessage.mock.calls.some(call => call[0].type === 'assets')).toBe(false);
});
