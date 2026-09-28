import { expect, it } from 'vitest';
import { renderDocument } from '../../src/features/export/renderDocument';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { Editor } from '@tiptap/core';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { nativeTestEditor } from '../editor-md/nativeTestEditor';
import { parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';

it('导出使用相同公式语法、提示块和可重复表头，排除编辑控件', async () => {
  const markdown = '# Report\n\n> [!IMPORTANT]\n> 正文 $ x^2 $\n\n\\[\\begin{pmatrix}1&2\\\\[2pt]3&4\\end{pmatrix}\\]\n\n| A | B |\n| - | - |\n| 1 | 2 |';
  const result = await renderDocument(markdown + '\n\n- [x] 已完成\n- [ ] 待完成', 'Report', '');
  const root = document.createElement('div'); root.innerHTML = result.html;
  expect(root.querySelectorAll('.katex').length).toBe(2);
  expect(root.querySelector('.github-alert-important svg')).not.toBeNull();
  expect(root.querySelector('thead th')?.textContent).toBe('A');
  expect(root.querySelector('textarea,button,input')).toBeNull();
  expect(root.querySelectorAll('.export-task-check')).toHaveLength(2);
  const tasks = root.querySelectorAll('li[data-type="taskItem"]');
  expect(tasks[0].querySelector('.export-task-check path')).not.toBeNull();
  expect(tasks[1].querySelector('.export-task-check path')).toBeNull();
  const ast = pandocSource(markdown);
  expect(ast).toContain('InlineMath'); expect(ast).toContain('DisplayMath');
  expect(ast).toContain('pmatrix'); expect(ast).toContain('Important');
});

it('prints the live completion state before saving and retains it across native save/reload', async () => {
  const editor = nativeTestEditor(new Editor({ extensions: buildDocumentExtensions(), content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>task</p></li></ul>' }));
  try {
    const checkbox = editor.view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const doc = editor.state.doc;
    expect(doc.firstChild!.firstChild!.attrs.checked).toBe(true);
    for (const snapshot of [doc, parseNativeNode(serializeNativeNode(doc), editor.schema)]) {
      const result = await renderDocument('- [ ] stale source', 'test', '', undefined, snapshot);
      const root = document.createElement('div'); root.innerHTML = result.html;
      expect(root.querySelector('.export-task-check')?.getAttribute('aria-label')).toBe('已完成');
      expect(root.querySelector('.export-task-check path')).not.toBeNull();
      expect(root.querySelector('li')?.dataset.checked).toBe('true');
    }
    editor.commands.undo();
    const result = await renderDocument('', 'test', '', undefined, editor.state.doc);
    const root = document.createElement('div'); root.innerHTML = result.html;
    expect(root.querySelector('.export-task-check path')).toBeNull();
  } finally { editor.destroy(); }
});
