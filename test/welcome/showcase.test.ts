import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import { decodeNativeDocument, visitNativeDocument } from '@/core/nativeDocument';
import { documentParser } from '@/features/editor-md/documentExtensions';
import { parseNativeNode, serializeNativeNode } from '@/features/editor-md/editorDocumentCodec';
import { openShowcase } from '@/features/welcome/welcomeActions';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'showcase-test' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/features/explorer/explorerActions', () => ({ openExplorerDirectory: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/openDocument', () => ({ openDocument: vi.fn() }));
vi.mock('@/features/editor-host/editorLoaders', () => ({ prefetchEditor: vi.fn(), resolveEditorKind: () => 'markdown' }));

const showcase = readFileSync('src/features/welcome/showcase.nb', 'utf8');
const nodesOf = (root: JSONContent, type: string): JSONContent[] => {
  const nodes: JSONContent[] = [];
  visitNativeDocument(root, node => { if (node.type === type) nodes.push(node); });
  return nodes;
};

beforeEach(() => {
  useWindowStore.setState({ tabs: [], activeKey: null });
  useDocumentStore.setState({ documents: new Map() });
});
afterEach(() => { vi.clearAllMocks(); });

describe('bundled native feature showcase', () => {
  it('opens an editable native copy, preserving the empty-window guard', async () => {
    await openShowcase(true);
    const tab = useWindowStore.getState().activeTab()!;
    const document = useDocumentStore.getState().getDocument(tab.key)!;
    expect(tab).toMatchObject({ kind: 'noteboard', displayName: '欢迎使用 NoteBoard.nb', path: null, language: 'json' });
    expect(document).toMatchObject({ kind: 'noteboard', readonly: false, content: showcase });
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
      expect(source).toMatch(/^data:image\/png;base64,/);
      const bytes = Buffer.from(source.split(',')[1], 'base64');
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
