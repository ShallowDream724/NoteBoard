import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { decodeNativeDocument, visitNativeDocument } from '@/core/nativeDocument';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { parseNativeNode, serializeNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { openShowcase } from '@/features/welcome/welcomeActions';
import { storeImageAsset } from '@/core/ipc/commands';
import { showToast } from '@/stores/toastStore';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'showcase-test' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/features/explorer/explorerActions', () => ({ openExplorerDirectory: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/openDocument', () => ({ openDocument: vi.fn() }));
vi.mock('@/features/editor-host/editorLoaders', () => ({ prefetchEditor: vi.fn(), resolveEditorKind: () => 'markdown' }));
vi.mock('@/stores/toastStore', () => ({ showToast: vi.fn() }));
const resources = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('@/core/ipc/commands', async importOriginal => ({ ...await importOriginal<typeof import('@/core/ipc/commands')>(),
  ensureStagingDirectory: async () => 'C:\\recovery',
  storeImageAsset: vi.fn(async (directory: string, extension: string, bytes: Uint8Array) => {
    const filename = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    resources.set(`${directory}\\${filename}`, bytes); return filename;
  }),
}));

const showcase = readFileSync('src/features/welcome/showcase.nb', 'utf8');
const nodesOf = (root: JSONContent, type: string): JSONContent[] => {
  const nodes: JSONContent[] = [];
  visitNativeDocument(root, node => { if (node.type === type) nodes.push(node); });
  return nodes;
};

beforeEach(() => {
  resources.clear(); vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const name = String(url).match(/(morning|forest|evening)/)?.[1];
    if (!name) throw new Error(`Unexpected asset URL ${url}`);
    return { ok: true, arrayBuffer: async () => Uint8Array.from(readFileSync(`examples/assets/${name}.png`)).buffer };
  }));
  useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.setState({ documents: new Map() });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('bundled native feature showcase', () => {
  it('reports a failed image write without an incomplete tab and allows retry', async () => {
    vi.mocked(storeImageAsset).mockRejectedValueOnce('无法写入图片目录');
    await expect(openShowcase()).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('无法打开功能示例：无法写入图片目录', 'error', 5000);
    expect(useWindowStore.getState().tabs).toHaveLength(0);
    expect(useDocumentStore.getState().documents.size).toBe(0);
    await openShowcase();
    expect(useWindowStore.getState().tabs).toHaveLength(1);
    expect(resources.size).toBe(3);
  });

  it('opens an editable native copy, preserving the empty-window guard', async () => {
    await openShowcase(true);
    const tab = useWindowStore.getState().activeTab()!;
    const document = useDocumentStore.getState().getDocument(tab.key)!;
    expect(tab).toMatchObject({ kind: 'noteboard', displayName: '欢迎使用 NoteBoard.nb', path: null, language: 'json' });
    expect(document).toMatchObject({ kind: 'noteboard', readonly: false });
    expect(document.content).not.toContain('data:image/');
    expect(document.content).not.toContain('./assets/');
    expect(document.content).toContain('C:/recovery/.noteboard-assets/');
    expect(resources.size).toBe(3);
    expect(tab.key).toMatch(/^untitled:noteboard:/);
    await openShowcase(true);
    expect(useWindowStore.getState().tabs).toHaveLength(1);
    await openShowcase();
    expect(useWindowStore.getState().tabs).toHaveLength(2);
    expect(useWindowStore.getState().activeKey).not.toBe(tab.key);
  });

  it('opens and saves the complete example with the strict native grammar', () => {
    expect(readFileSync('examples/rich-document.nb', 'utf8')).toBe(showcase);
    const schema = documentParser().schema;
    const doc = parseNativeNode(showcase, schema);
    expect(parseNativeNode(serializeNativeNode(doc, 'C:/notes/moved'), schema).eq(doc)).toBe(true);
    const json = decodeNativeDocument(showcase);
    for (const type of ['mathInline', 'mathBlock', 'table', 'taskList', 'codeBlock', 'mermaidBlock', 'githubAlert', 'disclosure']) {
      expect(nodesOf(json, type).length, type).toBeGreaterThan(0);
    }
    expect(nodesOf(json, 'githubAlert').map(node => node.attrs?.kind)).toEqual(expect.arrayContaining(['note', 'tip', 'important', 'warning', 'caution']));
    expect(doc.textContent).toContain('顶部工具栏的图片菜单');
    expect(doc.textContent).toContain('添加说明');
  });

  it('contains a four-slot grid with one empty slot and a working multi-image carousel', () => {
    const json = decodeNativeDocument(showcase);
    const collections = nodesOf(json, 'imageCollection');
    expect(collections).toHaveLength(2);
    const grid = collections.find(node => node.attrs?.layout === 'grid')!;
    expect(grid.attrs?.columns).toBe(2);
    expect(grid.content).toHaveLength(4);
    expect(grid.content?.filter(slot => !nodesOf(slot, 'image').length)).toHaveLength(1);
    expect(nodesOf(grid, 'image')).toHaveLength(3);
    const carousel = collections.find(node => node.attrs?.layout === 'carousel')!;
    expect(nodesOf(carousel, 'image')).toHaveLength(3);
    expect(carousel.content?.every(slot => nodesOf(slot, 'image').length === 1)).toBe(true);
    const sources = new Set(nodesOf(json, 'image').map(image => String(image.attrs?.src)));
    expect(sources.size).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      expect(source).toMatch(/^\.\/assets\/\w+\.png$/);
      const bytes = readFileSync(`examples/${source.slice(2)}`);
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(400);
      expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(240);
    }
  });

  it('pairs every text annotation with a useful body and preserves conceal examples', () => {
    const json = decodeNativeDocument(showcase);
    const references: string[] = [];
    let concealed = false;
    visitNativeDocument(json, node => {
      for (const mark of node.marks ?? []) {
        if (mark.type === 'annotationReference') references.push(String(mark.attrs?.id));
        if (mark.type === 'conceal') concealed = true;
      }
    });
    const bodies = nodesOf(json, 'annotationBody');
    expect(references.length).toBeGreaterThan(0);
    expect(bodies.map(body => body.attrs?.id).sort()).toEqual([...new Set(references)].sort());
    for (const body of bodies) {
      expect(nodesOf(body, 'text').map(node => node.text).join('').length).toBeGreaterThan(30);
    }
    expect(concealed).toBe(true);
    expect(nodesOf(json, 'disclosure').some(node => node.attrs?.open === false)).toBe(true);
  });
});
