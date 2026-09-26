import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { ImageNode } from '@/features/editor-md/documentNodes';
import { annotationSchemaExtensions } from '@/features/editor-md/annotations/schema';
import { AnnotationBehavior, annotationIndexKey } from '@/features/editor-md/annotations/extension';
import { addAnnotation, removeAnnotation } from '@/features/editor-md/annotations/commands';
import { InteractiveImageCollection, InteractiveImageSlot } from '@/features/editor-md/rich-content/views';
import { nativeTestEditor } from './nativeTestEditor';

const editors: Editor[] = [];
const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'A note' }] }];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function create(content: object) {
  const editor = new Editor({ extensions: [StarterKit, ImageNode, InteractiveImageCollection, InteractiveImageSlot, ...annotationSchemaExtensions, AnnotationBehavior], content });
  editors.push(editor); return nativeTestEditor(editor);
}

describe('annotation marker ownership', () => {
  it('keeps the widget fallback for a schema-only image view', () => {
    const editor = create({ type: 'doc', content: [{ type: 'image', attrs: { src: 'sample.png' } }] });
    const id = addAnnotation(editor, body, { selection: NodeSelection.create(editor.state.doc, 0), open: false })!;
    expect(editor.view.dom.querySelectorAll(`.nb-annotation-block-marker [data-annotation-id="${id}"]`)).toHaveLength(1);
  });

  it('keeps one collection marker through width changes and removes it with its note', () => {
    const editor = create({ type: 'doc', content: [{ type: 'imageCollection', content: [{ type: 'imageSlot' }] }] });
    const id = addAnnotation(editor, body, { selection: NodeSelection.create(editor.state.doc, 0), open: false })!;
    const findMarker = () => editor.view.dom.querySelector(`[data-annotation-id="${id}"].nb-annotation-indicator`)!;
    expect(findMarker()?.parentElement?.className).toBe('nb-annotation-edge-marker');
    expect(editor.view.dom.querySelector('.nb-annotation-block-marker')).toBeNull();
    const anchor = annotationIndexKey.getState(editor.state)!.anchors.find(anchor => anchor.id === id)!;
    const node = editor.state.doc.nodeAt(anchor.from)!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(anchor.from, undefined, { ...node.attrs, width: '50%', align: 'right' }));
    expect(findMarker()?.parentElement?.hidden).toBe(false);
    expect(editor.view.dom.querySelectorAll(`[data-annotation-id="${id}"].nb-annotation-indicator`)).toHaveLength(1);
    expect(removeAnnotation(editor, id)).toBe(true);
    expect(findMarker()).toBeNull();
    expect(editor.state.doc.firstChild?.type.name).toBe('imageCollection');
  });
});
