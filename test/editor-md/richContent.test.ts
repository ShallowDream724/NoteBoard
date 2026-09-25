// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions, documentParser } from '../../src/features/editor-md/documentExtensions';
import { imageCollectionTemplate, insertImageCollection, insertDisclosure, toggleConceal } from '../../src/features/editor-md/rich-content/commands';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { NodeSelection } from '@tiptap/pm/state';
import { readFileSync } from 'node:fs';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); });
const editor = () => { const value = new Editor({ extensions: buildDocumentExtensions(), content: '<p>原文</p>' }); editors.push(value); return value; };
describe('rich document content contract', () => {
  it('opens the public hand-authoring example with the shared strict schema', () => {
    const text = readFileSync('examples/rich-document.nb', 'utf8');
    const schema = documentParser().schema, doc = parseNativeNode(text, schema);
    expect(parseNativeNode(serializeNativeNode(doc), schema).eq(doc)).toBe(true);
    expect(doc.textContent.length).toBeGreaterThan(20);
  });
  it('creates grid and carousel templates as one undoable insertion with empty slots', () => {
    for (const template of [4, 6, 9, 'carousel'] as const) {
      const value = editor(), before = value.state.doc.toJSON();
      insertImageCollection(value, template);
      let slots = 0; value.state.doc.descendants(node => { if (node.type.name === 'imageSlot') slots++; });
      expect(slots).toBe(template === 'carousel' ? 3 : template);
      expect(value.commands.undo()).toBe(true); expect(value.state.doc.toJSON()).toEqual(before);
      expect(value.commands.redo()).toBe(true);
    }
  });
  it('round trips hand-authored image slots, captions, styles and disclosure contents', () => {
    const json = { type: 'doc', content: [imageCollectionTemplate(4), { type: 'disclosure', attrs: { title: '完整记录', open: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '隐藏也不能丢失', marks: [{ type: 'conceal' }] }] }] }] };
    json.content[0].content![1] = { type: 'imageSlot', content: [{ type: 'image', attrs: { src: './img/a.png' } }, { type: 'paragraph', content: [{ type: 'text', text: '图注' }] }] };
    const schema = documentParser().schema, doc = parseNativeNode(encodeNativeDocument(json), schema);
    expect(parseNativeNode(serializeNativeNode(doc), schema).eq(doc)).toBe(true);
    expect(doc.textContent).toContain('隐藏也不能丢失'); expect(doc.firstChild?.child(0).childCount).toBe(0);
  });
  it('stores block conceal and disclosure creation in ordinary undo history', () => {
    const value = editor(); insertDisclosure(value); value.commands.undo();
    value.view.dispatch(value.state.tr.setSelection(NodeSelection.create(value.state.doc, 0)));
    expect(toggleConceal(value)).toBe(true); expect(value.state.doc.firstChild?.attrs.concealed).toBe(true);
    value.commands.undo(); expect(value.state.doc.firstChild?.attrs.concealed).toBe(false);
  });
  it('canonicalizes hand-written note metadata and rejects dangling references without data loss', () => {
    const schema = documentParser().schema;
    const body = { type: 'paragraph', content: [{ type: 'text', text: '说明锚点', marks: [{ type: 'annotationReference', attrs: { id: 'note-1' } }] }] };
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [body] }), schema)).toThrow('找不到');
    const store = { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'note-1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '说明正文' }] }] }] };
    const result = parseNativeNode(encodeNativeDocument({ type: 'doc', content: [body, store] }), schema);
    expect(result.firstChild?.type.name).toBe('annotationStore');
    expect(result.textContent).toContain('说明正文');
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [body, store, store] }), schema)).toThrow('一个');
    const nested = structuredClone(store);
    nested.content[0].content = [body];
    expect(() => parseNativeNode(encodeNativeDocument({ type: 'doc', content: [body, nested] }), schema)).toThrow('嵌套');
  });
});
