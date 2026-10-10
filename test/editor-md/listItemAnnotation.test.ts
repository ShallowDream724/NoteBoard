import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { AnnotationBehavior } from '@/features/editor-md/annotations/extension';
import { addAnnotation, beginBlockAnnotation, blockAnnotationTarget, canAddAnnotation, selectedAnnotationId, ANNOTATION_BEGIN_EVENT } from '@/features/editor-md/annotations/commands';
import { annotationAnchors, collectAnnotations } from '@/features/editor-md/annotations/model';
import { restoreBlockParagraph } from '@/features/editor-md/blockActions';
import { moveTopLevelBlock } from '@/features/editor-md/blockReorder';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
function create(content: JSONContent[]) {
  const editor = nativeTestEditor(new Editor({ extensions: [...buildDocumentExtensions(), AnnotationBehavior], content: { type: 'doc', content } }));
  editors.push(editor); return editor;
}
function itemPos(editor: Editor, type: string, text: string) {
  let result = -1;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === type && node.firstChild?.textContent === text) result = pos; });
  expect(result).toBeGreaterThanOrEqual(0); return result;
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

describe('list-item explanation ownership', () => {
  it.each(['bulletList', 'orderedList', 'taskList'])('anchors %s notes to its main paragraph across reorder and restore', list => {
    const type = list === 'taskList' ? 'taskItem' : 'listItem';
    const editor = create([{ type: list, content: ['one', 'two'].map(text => ({ type, attrs: { checked: true }, content: [p(text)] })) }, p('end')]);
    const pos = itemPos(editor, type, 'one'), target = blockAnnotationTarget(editor.state.doc, pos)!;
    expect(target.pos).toBe(pos + 1); expect(target.node.type.name).toBe('paragraph');
    editor.commands.setNodeSelection(pos); expect(canAddAnnotation(editor)).toBe(true);
    const id = addAnnotation(editor, [p('Explanation')], { open: false })!;
    expect(id).not.toBeNull(); expect(selectedAnnotationId(editor)).toBe(id);
    expect(annotationAnchors(editor.state.doc).filter(anchor => anchor.id === id)).toHaveLength(1);
    expect(editor.state.doc.nodeAt(itemPos(editor, type, 'one'))!.firstChild!.attrs.annotationId).toBe(id);
    const annotated = editor.state.doc;
    const end = itemPos(editor, type, 'two') + editor.state.doc.nodeAt(itemPos(editor, type, 'two'))!.nodeSize;
    expect(moveTopLevelBlock(editor.view, itemPos(editor, type, 'one'), end)).not.toBeNull();
    const reordered = editor.state.doc;
    expect(restoreBlockParagraph(editor, itemPos(editor, type, 'one'))).toBe(true);
    const restored = editor.state.doc, anchor = annotationAnchors(restored).find(value => value.id === id)!;
    expect(restored.nodeAt(anchor.from)!.type.name).toBe('paragraph');
    expect(restored.nodeAt(anchor.from)!.textContent).toBe('one');
    expect(collectAnnotations(restored).get(id)?.node.textContent).toBe('Explanation');
    expect(annotationAnchors(restored).filter(value => value.id === id)).toHaveLength(1);
    restored.check(); editor.commands.undo(); expect(editor.state.doc.eq(reordered)).toBe(true);
    editor.commands.undo(); expect(editor.state.doc.eq(annotated)).toBe(true);
    editor.commands.redo(); editor.commands.redo(); expect(editor.state.doc.eq(restored)).toBe(true);
  });

  it('captures a todo draft at its paragraph and keeps a nested restore in the original parent', () => {
    const editor = create([{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('parent'), { type: 'taskList', content: [{ type: 'taskItem', content: [p('child')] }] }] }] }, p('end')]);
    const pos = itemPos(editor, 'taskItem', 'child'), event = vi.fn();
    editor.view.dom.addEventListener(ANNOTATION_BEGIN_EVENT, event);
    try {
      expect(beginBlockAnnotation(editor, pos)).not.toBeNull(); expect(event).toHaveBeenCalledOnce();
      expect(collectAnnotations(editor.state.doc).size).toBe(0);
      const initial = editor.state.doc;
      expect(restoreBlockParagraph(editor, pos)).toBe(true);
      const parent = editor.state.doc.firstChild!.firstChild!;
      expect(parent.type.name).toBe('taskItem'); expect(parent.attrs.checked).toBe(true);
      expect(parent.content.content.map(node => node.textContent)).toEqual(['parent', 'child']);
      editor.commands.undo(); expect(editor.state.doc.eq(initial)).toBe(true);
    } finally { editor.view.dom.removeEventListener(ANNOTATION_BEGIN_EVENT, event); }
  });
});
