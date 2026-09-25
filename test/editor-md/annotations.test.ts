import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { ImageNode } from '@/features/editor-md/documentNodes';
import { annotationSchemaExtensions } from '@/features/editor-md/annotations/schema';
import { AnnotationBehavior, annotationIndexKey } from '@/features/editor-md/annotations/extension';
import { addAnnotation, canAddAnnotation, removeAnnotation, selectedAnnotationId, updateAnnotation } from '@/features/editor-md/annotations/commands';
import { annotationAnchors, annotationBodiesForFragment, collectAnnotations, remapAnnotationIds } from '@/features/editor-md/annotations/model';
import { constrainAnnotationGeometry } from '@/features/editor-md/annotations/geometry';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function create(content: JSONContent[] = [paragraph('Anchor words here')]) {
  const editor = new Editor({ extensions: [StarterKit, ImageNode, ...annotationSchemaExtensions, AnnotationBehavior], content: { type: 'doc', content } });
  editors.push(editor); return nativeTestEditor(editor);
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); vi.restoreAllMocks(); });

describe('补充说明文档状态', () => {
  it('stores one rich body for formatted text fragments and atomically undoes/replays creation', () => {
    const editor = create([{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and plain' }] }]);
    const initial = editor.state.doc;
    editor.commands.setTextSelection({ from: 1, to: 15 });
    const body = [paragraph('Long body '.repeat(200)), { type: 'image', attrs: { src: 'notes.assets/example.png', alt: 'Example' } }];
    const id = addAnnotation(editor, body)!;
    expect(collectAnnotations(editor.state.doc).size).toBe(1);
    const offset = editor.state.doc.firstChild!.nodeSize;
    expect(editor.state.doc.firstChild!.type.name).toBe('annotationStore');
    expect(annotationAnchors(editor.state.doc)).toEqual([{ id, from: offset + 1, to: offset + 15, block: false }]);
    expect(collectAnnotations(editor.state.doc).get(id)?.node.content.size).toBeGreaterThan(1900);
    expect(JSON.stringify(editor.getJSON()).match(/Long body/g)).toHaveLength(200);
    expect(editor.view.dom.querySelector('[data-annotation-store]')?.hasAttribute('hidden')).toBe(true);
    editor.state.doc.check();
    editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
    editor.commands.redo(); expect(collectAnnotations(editor.state.doc).has(id)).toBe(true);
  });

  it('supports selected images and preserves anchor content when removing the entity', () => {
    const editor = create([{ type: 'image', attrs: { src: 'test.png' } }, paragraph('After')]);
    editor.commands.setNodeSelection(0);
    const id = addAnnotation(editor, [paragraph('Image explanation')])!;
    expect(selectedAnnotationId(editor)).toBe(id);
    expect(editor.state.selection.$from.nodeAfter?.attrs.annotationId).toBe(id);
    const before = editor.state.doc;
    expect(removeAnnotation(editor, id)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('image');
    expect(editor.state.doc.firstChild?.attrs.annotationId).toBeNull();
    expect(collectAnnotations(editor.state.doc).size).toBe(0);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('offers code explanations for the selected block, without creating an unanchored text note', () => {
    const editor = create([{ type: 'codeBlock', content: [{ type: 'text', text: 'const count = 1' }] }]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(canAddAnnotation(editor)).toBe(false);
    expect(addAnnotation(editor)).toBeNull();
    editor.commands.setNodeSelection(0);
    expect(canAddAnnotation(editor)).toBe(true);
    expect(addAnnotation(editor)).not.toBeNull();
  });

  it('saves rich body replacement in one independent history action', () => {
    const editor = create(); editor.commands.setTextSelection({ from: 1, to: 7 });
    const id = addAnnotation(editor, [paragraph('Before')])!;
    const initialBody = collectAnnotations(editor.state.doc).get(id)!.node;
    expect(updateAnnotation(editor, id, [{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Updated')] }] }])).toBe(true);
    expect(collectAnnotations(editor.state.doc).get(id)!.node.textContent).toBe('Updated');
    editor.commands.undo(); expect(collectAnnotations(editor.state.doc).get(id)!.node.eq(initialBody)).toBe(true);
    editor.commands.undo(); expect(collectAnnotations(editor.state.doc).size).toBe(0);
  });

  it('deleting the final anchor deletes its body in the same undo group', () => {
    const editor = create(); editor.commands.setTextSelection({ from: 1, to: 7 });
    const id = addAnnotation(editor, [paragraph('Preserved by undo')])!;
    const before = editor.state.doc;
    const range = annotationAnchors(editor.state.doc)[0];
    editor.commands.deleteRange({ from: range.from, to: range.to });
    expect(collectAnnotations(editor.state.doc).has(id)).toBe(false);
    editor.commands.undo(); expect(editor.state.doc.eq(before)).toBe(true);
    editor.commands.redo(); expect(collectAnnotations(editor.state.doc).has(id)).toBe(false);
  });

  it('does not repeat or recursively attach annotations inside a rich body', () => {
    const editor = create(); editor.commands.setTextSelection({ from: 1, to: 7 });
    const id = addAnnotation(editor)!;
    expect(addAnnotation(editor)).toBeNull();
    updateAnnotation(editor, id, [{ type: 'paragraph', attrs: { annotationId: 'nested' }, content: [{ type: 'text', text: 'Body', marks: [{ type: 'annotationReference', attrs: { id: 'nested' } }] }] }, { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'nested' }, content: [paragraph('Recursive')] }] }]);
    const body = collectAnnotations(editor.state.doc).get(id)!.node;
    expect(body.textContent).toBe('Body');
    expect(body.firstChild!.attrs.annotationId).toBeNull();
    expect(body.firstChild!.firstChild!.marks).toHaveLength(0);
  });

  it('copies only referenced bodies and remaps each shared ID once', () => {
    const editor = create(); editor.commands.setTextSelection({ from: 1, to: 7 });
    const id = addAnnotation(editor, [paragraph('Definition')])!;
    const fragment = { type: 'doc', content: [editor.state.doc.child(1).toJSON()] };
    const bodies = annotationBodiesForFragment(editor.state.doc, fragment);
    expect(bodies).toHaveLength(1);
    const original = { ...fragment, content: [...fragment.content, { type: 'annotationStore', content: bodies }] };
    const copied = remapAnnotationIds(original, () => 'copied_id');
    expect(copied.content![0].content![0].marks![0].attrs!.id).toBe('copied_id');
    expect(copied.content![1].content![0].attrs!.id).toBe('copied_id');
    expect(original.content[0].content![0].marks![0].attrs!.id).toBe(id);
  });

  it('maps unaffected entities and inspects only changed textblocks while typing in a long document', () => {
    const editor = create(Array.from({ length: 4000 }, (_, index) => paragraph(`Paragraph ${index}`)));
    const visitedRanges: { from: number; to: number }[] = [];
    const original = ProseMirrorNode.prototype.nodesBetween;
    vi.spyOn(ProseMirrorNode.prototype, 'nodesBetween').mockImplementation(function (this: ProseMirrorNode, from, to, callback, start) {
      if (this.type.name === 'doc') visitedRanges.push({ from, to });
      return original.call(this, from, to, callback, start);
    });
    editor.view.dispatch(editor.state.tr.insertText('x', 2));
    expect(visitedRanges.length).toBeGreaterThan(0);
    expect(visitedRanges.every(range => range.to - range.from < 30)).toBe(true);
    vi.restoreAllMocks();
    editor.commands.setTextSelection({ from: 1, to: 8 });
    const id = addAnnotation(editor, [paragraph('Body')])!;
    const before = annotationIndexKey.getState(editor.state)!.records.get(id)!;
    editor.view.dispatch(editor.state.tr.insertText('two', annotationAnchors(editor.state.doc)[0].from + 1));
    const index = annotationIndexKey.getState(editor.state)!;
    expect(index.anchors).toEqual(annotationAnchors(editor.state.doc));
    expect(index.records.get(id)!.pos).toBe(before.pos);
    expect(index.records.get(id)!.node).toBe(before.node);
    expect(index.records.get(id)!.pos).toBe(collectAnnotations(editor.state.doc).get(id)!.pos);
  });
});

it('constrains floating geometry within a resized editor pane', () => {
  expect(constrainAnnotationGeometry({ x: 1000, y: 900, width: 600, height: 700 }, { left: 100, top: 50, width: 320, height: 280 }))
    .toEqual({ x: 108, y: 58, width: 304, height: 264 });
});
