import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { EnhancedImageBlock } from '../../src/features/editor-md/imageNodeView';
import { createAnnotationBodyView } from '../../src/features/editor-md/annotations/bodyView';
import { useDocumentStore, type Document } from '../../src/stores/documentStore';
import { useImageDisplayPreview } from '../../src/features/editor-md/imagePreviewCache';
import { TooltipProvider } from '../../src/components/Tooltip';
import { nativeTestEditor } from './nativeTestEditor';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${encodeURIComponent(path)}`) }));
vi.mock('../../src/features/editor-md/imagePreviewCache', () => ({ useImageDisplayPreview: vi.fn((src: string) => src) }));

const key = 'test-network-images';
let editor: Editor, root: Root | undefined, view: EditorView | undefined;
let previousDocuments: ReturnType<typeof useDocumentStore.getState>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  previousDocuments = useDocumentStore.getState();
  useDocumentStore.setState({ documents: new Map([[key, { key, dirPath: 'C:\\notes' } as Document]]) });
  vi.mocked(convertFileSrc).mockClear(); vi.mocked(useImageDisplayPreview).mockClear();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined; view?.destroy(); view = undefined; editor?.destroy(); });
  useDocumentStore.setState(previousDocuments, true); document.body.replaceChildren(); vi.unstubAllGlobals();
});
function makeEditor(src: string) {
  return nativeTestEditor(new Editor({ extensions: buildDocumentExtensions({ image: EnhancedImageBlock.configure({ docKey: key }) }),
    content: { type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'Photo' } }, { type: 'paragraph' }] } }));
}
async function mount(src: string) {
  editor = makeEditor(src); const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => { root!.render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); await new Promise(resolve => setTimeout(resolve, 0)); });
  return host;
}

it.each([String.raw`\\server\share\a.png`, 'file://server/share/a.png',
  'http://asset.localhost/%255c%255cserver%255cshare%255ca.png'])('does not assign or thumbnail an authored remote image %s', async src => {
  const host = await mount(src);
  expect(convertFileSrc).not.toHaveBeenCalled();
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('网络共享图片未自动加载');
  expect(vi.mocked(useImageDisplayPreview).mock.calls.every(([source]) => source === '')).toBe(true);
  expect(editor.state.doc.firstChild!.attrs.src).toBe(src);
  expect(host.textContent).not.toContain('重新加载');
});

it('allows a same-share relative image without granting permission to an absolute image on the next edit', async () => {
  useDocumentStore.setState({ documents: new Map([[key, { key, dirPath: String.raw`\\server\share\notes` } as Document]]) });
  const host = await mount('../assets/a.png');
  expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith(String.raw`\\server\share\assets\a.png`);
  expect(host.querySelector('img')?.getAttribute('src')).toContain('asset.localhost');
  vi.mocked(convertFileSrc).mockClear();
  await act(async () => { editor.commands.updateAttributes('image', { src: String.raw`\\other\share\a.png` }); });
  expect(convertFileSrc).not.toHaveBeenCalled(); expect(host.querySelector('img')).toBeNull();
});

it('applies the same rule inside annotation bodies and leaves authored source intact', () => {
  editor = makeEditor('local.png');
  const src = 'asset://localhost/%5c%5cserver%5cshare%5ca.png';
  const body = editor.schema.nodes.annotationBody.createChecked({ id: 'body' }, [editor.schema.nodes.image.create({ src })]);
  const host = document.body.appendChild(document.createElement('div'));
  view = createAnnotationBodyView(host, editor, body, false);
  expect(convertFileSrc).not.toHaveBeenCalled(); expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('网络共享图片未自动加载');
  expect(view.state.doc.firstChild!.attrs.src).toBe(src);
});
