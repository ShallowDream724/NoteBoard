import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, EditorContent, type JSONContent } from '@tiptap/react';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';
import { initializeEditorDocument, parseEditorDocument, serializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { setParagraphPresentation } from '../../src/features/document-style/documentStyles';
import { prepareDocument, prepareHtmlExport } from '../../src/features/export/documentConversion';
import exportCss from '../../src/features/export/document.css?inline';
import { CodeBlockView } from '../../src/features/editor-md/codeBlockView';
import { CodeHighlight } from '../../src/features/editor-md/codeHighlightExtension';
import { TooltipProvider } from '../../src/components/Tooltip';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { runDiscreteEdit } from '../../src/features/editor-md/discreteEdit';

const host = document.getElementById('root')!;
host.style.cssText = 'width:800px;padding:20px;margin:20px;font-size:18px';
const editor = new Editor({
  extensions: [...buildDocumentExtensions({ mathBlock: MathBlock, mathInline: MathInline, codeBlock: CodeBlockView }), CodeHighlight],
  content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Inline: ' }, { type: 'mathInline', attrs: { latex: 'a+b' } }] },
    ...['note', 'tip', 'important', 'warning', 'caution'].map(kind => ({ type: 'githubAlert', attrs: { kind }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout body' }] }] })),
    { type: 'githubAlert', attrs: { kind: 'note', title: '', icon: '🌱', backgroundColor: '#fff7ed' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Custom callout' }] }] },
  ] },
});
initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
createRoot(host).render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>);
let historySnapshot = '';
const qa = {
  mountSharedHistory() {
    const key = 'untitled:browser-math-history';
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'math-history.nb', dirPath: '', kind: 'noteboard', language: 'markdown',
      content: encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] }),
      encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
    useWindowStore.getState().openTab({ key, displayName: 'math-history.nb', path: null, kind: 'noteboard', language: 'markdown',
      isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
    const container = document.createElement('div');
    container.dataset.mathSharedHistory = '';
    document.body.appendChild(container);
    createRoot(container).render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>);
  },
  insertSharedBlock() {
    runDiscreteEdit(getMdTipTapEditor('untitled:browser-math-history')!, chain => chain.focus('end').insertContent({ type: 'mathBlock', attrs: { latex: '' } }));
  },
  prepareSharedInline() {
    getMdTipTapEditor('untitled:browser-math-history')!.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Before ' }, { type: 'mathInline', attrs: { latex: '' } }, { type: 'text', text: ' After' },
    ] }] });
  },
  async prepareSharedScroll(fresh = false) {
    await import('../../src/styles/globals.css');
    host.style.display = 'none';
    document.querySelector<HTMLElement>('[data-math-shared-history]')!.style.cssText = 'height:700px;width:900px';
    getMdTipTapEditor('untitled:browser-math-history')!.commands.setContent({ type: 'doc', content: [
      ...Array.from({ length: 8 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Before ${i}` }] })),
      ...(fresh ? [] : [{ type: 'mathBlock', attrs: { latex: 'a' } }]),
      ...Array.from({ length: 80 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `After ${i}` }] })),
    ] });
    if (fresh) {
      const editor = getMdTipTapEditor('untitled:browser-math-history')!;
      const pos = Array.from({ length: 8 }, (_, i) => editor.state.doc.child(i).nodeSize).reduce((a, b) => a + b, 0);
      runDiscreteEdit(editor, chain => chain.focus().insertContentAt(pos, { type: 'mathBlock', attrs: { latex: '' } }).setNodeSelection(pos));
    }
  },
  sharedState() {
    const editor = getMdTipTapEditor('untitled:browser-math-history')!;
    const formulas: string[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'mathBlock' || node.type.name === 'mathInline') formulas.push(node.attrs.latex); });
    return { formulas, text: editor.state.doc.textContent };
  },
  align(value: 'left' | 'center' | 'right') {
    editor.commands.setNodeSelection(0);
    setParagraphPresentation(editor, { textAlign: value });
    return editor.state.doc.firstChild!.attrs.textAlign;
  },
  undo: () => editor.commands.undo(),
  reload: () => initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard'),
  matrix() {
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('mathBlock', { latex: '\\begin{bmatrix}' + Array.from({ length: 70 }, () => '1 & 2 & 3 & 4 & 5').join('\\\\') + '\\end{bmatrix}' });
  },
  prepareTyping() {
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '从顶部工具栏的图片菜单，可以插入单张图片、四宫格、六宫格、九宫格或图片轮播。下面的四宫格留了一格给你，点击空格即可加入自己的图片。图注也可以直接修改。' },
      { type: 'mathInline', attrs: { latex: 'a' } },
    ] }] });
    editor.commands.focus('end');
  },
  formulas() {
    const values: string[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'mathInline') values.push(node.attrs.latex); });
    return values;
  },
  prepareHistory() {
    editor.commands.setContent({ type: 'doc', content: [
      { type: 'mathBlock', attrs: { latex: 'x^2' } },
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def greet():\n    return 42' }] },
      { type: 'paragraph' },
    ] });
    historySnapshot = serializeEditorDocument(editor);
  },
  deleteFormula() { editor.commands.setNodeSelection(0); editor.commands.deleteSelection(); },
  restoreFormula() { parseEditorDocument(editor, historySnapshot, 'history'); },
  prepareInlineEntry() {
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before $$ after' }] }] });
    editor.commands.setTextSelection(9);
    editor.view.focus();
  },
  prepareSourceUndo(block: boolean) {
    editor.commands.setContent({ type: 'doc', content: block
      ? [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }, { type: 'mathBlock', attrs: { latex: '' } }, { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }]
      : [{ type: 'paragraph', content: [{ type: 'text', text: 'Before ' }, { type: 'mathInline', attrs: { latex: '' } }, { type: 'text', text: ' After' }] }] });
  },
  sourceUndoState() {
    const formulas: { type: string; latex: string }[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') formulas.push({ type: node.type.name, latex: node.attrs.latex }); });
    return { formulas, text: editor.state.doc.textContent };
  },
  text: () => editor.state.doc.textContent,
  async export() {
    const content: JSONContent = editor.getJSON();
    content.content!.push({ type: 'imageCollection', attrs: { layout: 'carousel', columns: 2 }, content: ['#3b82f6', '#10b981'].map(color => ({
      type: 'imageSlot', content: [{ type: 'image', attrs: { src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="${color}"/></svg>`), alt: 'Example image' } }],
    })) });
    const rendered = await prepareDocument(content, 'Math alignment', '', undefined, 'noteboard');
    const standalone = await prepareHtmlExport(content, 'Math alignment', '', undefined, 'noteboard');
    return { html: rendered.html, css: exportCss, standalone };
  },
};
declare global { interface Window { mathAlignmentQA: typeof qa } }
window.mathAlignmentQA = qa;
