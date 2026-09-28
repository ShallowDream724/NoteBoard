import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, Extension } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { describe, expect, it, vi } from 'vitest';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { mathContent } from '../../src/features/editor-md/insertContentRecipes';

describe('公式源码输入', () => {
  it('inserting an empty block opens and focuses its source without a second edit', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock, Markdown], content: '<p></p>' });
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditorContent editor={editor}/>));
      await act(async () => { editor.chain().focus().insertContent(mathContent('block')).run(); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
      expect(editor.state.doc.firstChild?.type.name).toBe('mathBlock');
      expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('块公式源码');
      expect(document.activeElement).toBe(host.querySelector('textarea'));
      await act(async () => { host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(host.querySelector('textarea')).toBeNull();
      await act(async () => { editor.commands.undo(); });
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
  });
  it('Ctrl+A selects the document without opening or focusing its formulas', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock, Markdown],
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before ' }, { type: 'mathInline', attrs: { latex: 'x' } }] },
        { type: 'mathBlock', attrs: { latex: 'y' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ] } });
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditorContent editor={editor}/>));
      await act(async () => { editor.view.focus(); editor.commands.selectAll(); });
      expect(editor.state.selection.from).toBeLessThanOrEqual(1);
      expect(editor.state.selection.to).toBeGreaterThanOrEqual(editor.state.doc.content.size - 1);
      expect(host.querySelector('textarea')).toBeNull();
      expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
      await act(async () => { host.querySelector('.math-node-display')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(host.querySelector('textarea')?.value).toBe('y');
    } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
  });
  for (const key of ['Backspace', 'Delete']) {
    it('空公式 ' + key + ' 删除节点后正文可继续输入，撤销可恢复', async () => {
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock, Markdown],
        content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { delimiter: '$$', latex: '' } }] } });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<EditorContent editor={editor} />));
        await act(async () => { host.querySelector('.math-node')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        const textarea = host.querySelector('textarea')!;
        await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true })); });
        expect(editor.state.doc.firstChild?.type.name).toBe('mathBlock');
        await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
        expect(host.querySelector('.math-node')).toBeNull();
        expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
        await act(async () => { editor.commands.undo(); });
        expect(editor.state.doc.firstChild?.type.name).toBe('mathBlock');
      } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
    });
  }
  it('即时进入文档、保留换行、忽略输入法确认键并把撤销交给宿主', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const undo = vi.fn(() => true);
    const history = Extension.create({ name: 'testDocumentHistory', priority: 1000,
      addKeyboardShortcuts: () => ({ 'Mod-z': undo }) });
    const editor = new Editor({ extensions: [StarterKit, history, MathInline, MathBlock, Markdown],
      content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { delimiter: '\\[', latex: 'x' } }] } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EditorContent editor={editor} />));
      await act(async () => { host.querySelector('.math-node')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const textarea = host.querySelector('textarea')!;
      expect(textarea).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'a+b\nc+d');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(serializeMarkdown(editor)).toContain('a+b\nc+d');
      expect(editor.state.doc.firstChild?.attrs.delimiter).toBe('\\[');
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })); });
      expect(host.querySelector('textarea')).not.toBeNull();
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); });
      expect(undo).toHaveBeenCalledTimes(1);
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
      expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(host.querySelector('textarea')).toBeNull();
    } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
  });
});
