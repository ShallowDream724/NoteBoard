import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, EditorContent } from '@tiptap/react';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';
import { initializeEditorDocument, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { setParagraphPresentation } from '../../src/features/document-style/documentStyles';
import { prepareDocument, prepareHtmlExport } from '../../src/features/export/documentConversion';
import exportCss from '../../src/features/export/document.css?inline';

const host = document.getElementById('root')!;
host.style.cssText = 'width:800px;padding:20px;margin:20px;font-size:18px';
const editor = new Editor({
  extensions: buildDocumentExtensions().map(extension => extension.name === 'mathBlock' ? MathBlock : extension.name === 'mathInline' ? MathInline : extension),
  content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Inline: ' }, { type: 'mathInline', attrs: { latex: 'a+b' } }] },
    ...['note', 'tip', 'important', 'warning', 'caution'].map(kind => ({ type: 'githubAlert', attrs: { kind }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout body' }] }] })),
    { type: 'githubAlert', attrs: { kind: 'note', title: '', icon: '🌱', backgroundColor: '#fff7ed' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Custom callout' }] }] },
  ] },
});
initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
createRoot(host).render(<EditorContent editor={editor}/>);
const qa = {
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
  async export() {
    const content = editor.getJSON();
    const rendered = await prepareDocument(content, 'Math alignment', '', undefined, 'noteboard');
    const standalone = await prepareHtmlExport(content, 'Math alignment', '', undefined, 'noteboard');
    return { html: rendered.html, css: exportCss, standalone };
  },
};
declare global { interface Window { mathAlignmentQA: typeof qa } }
window.mathAlignmentQA = qa;
