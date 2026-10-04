import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { TooltipProvider } from '@/components/Tooltip';
import { buildDocumentExtensions } from '@/features/editor-md/documentExtensions';
import { createAnnotationBodyView } from '@/features/editor-md/annotations/bodyView';
import { BodyFormatToolbar } from '@/features/editor-md/annotations/BodyFormatToolbar';

let editor: Editor, view: EditorView, root: Root;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const render = () => root.render(<TooltipProvider><BodyFormatToolbar view={view} state={view.state} imageInput={false} onImageInput={() => {}}/></TooltipProvider>);
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>Parent text</p>' });
  const host = document.createElement('div'), toolbar = document.createElement('div'); document.body.append(host, toolbar); root = createRoot(toolbar);
  view = createAnnotationBodyView(host, editor, editor.schema.nodes.annotationBody.create({ id: 'draft' },
    editor.schema.nodes.paragraph.create(null, editor.schema.text('Draft text'))), true, render);
  await act(async () => { render(); });
});
afterEach(async () => { await act(async () => root.unmount()); view.destroy(); editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('updates visual state and undo availability without losing the draft selection or editing its parent', async () => {
  const parent = editor.state.doc;
  expect(button('撤销说明编辑').disabled).toBe(true);
  await act(async () => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))); view.focus(); });
  const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => { button('下划线').dispatchEvent(pointer); button('下划线').click(); });
  expect(pointer.defaultPrevented).toBe(true); expect(button('下划线').getAttribute('aria-pressed')).toBe('true');
  expect(view.state.selection.from).toBe(1); expect(view.state.selection.to).toBe(6); expect(view.hasFocus()).toBe(true);
  expect(button('撤销说明编辑').disabled).toBe(false);
  await act(async () => button('撤销说明编辑').click());
  expect(button('下划线').getAttribute('aria-pressed')).toBe('false'); expect(button('重做说明编辑').disabled).toBe(false);
  expect(editor.state.doc).toBe(parent);
});

it('applies visual color swatches to the retained selection and disables text styling in a code block', async () => {
  await act(async () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))));
  await act(async () => button('文字颜色与高亮').click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="说明文字颜色"] button[aria-label="红色"]')!.click());
  expect(view.state.doc.firstChild!.firstChild!.marks.find(mark => mark.type.name === 'textColor')?.attrs.color).toBe('#dc2626');
  expect(view.state.selection.from).toBe(1); expect(view.state.selection.to).toBe(6);
  await act(async () => {
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.firstChild!.nodeSize, view.state.schema.nodes.codeBlock.create(null, view.state.schema.text('code'))));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  });
  expect(button('加粗').disabled).toBe(true); expect(button('文字颜色与高亮').disabled).toBe(true);
  expect(button('链接').disabled).toBe(true);
});
