import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';
import { FormulaSourceEditor } from '../../src/features/editor-md/FormulaSourceEditor';
import { MathBlock, MathInline } from '../../src/features/editor-md/katexExtensions';

function inputValue(element: HTMLTextAreaElement, value: string, composing = false) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: composing ? 'insertCompositionText' : 'insertText', isComposing: composing }));
}

describe('formula source IME ownership', () => {
  it.each([true, false])('keeps native preedit text and focus until composition ends, then commits punctuation once (display=%s)', async display => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host), change = vi.fn(), key = vi.fn(), close = vi.fn();
    const render = (value: string) => root.render(<FormulaSourceEditor value={value} display={display} onChange={change} onKeyDown={key} onClose={close}/>);
    try {
      await act(async () => render('x'));
      const textarea = host.querySelector('textarea')!;
      await act(async () => {
        textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        inputValue(textarea, 'xzhong', true);
      });
      expect(change).not.toHaveBeenCalled();
      await act(async () => render('x'));
      expect(textarea.value).toBe('xzhong');
      expect(document.activeElement).toBe(textarea);
      await act(async () => {
        // Some IMEs omit isComposing/229 on their candidate confirmation key.
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        inputValue(textarea, 'x中，', true);
        textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中，', bubbles: true }));
        inputValue(textarea, 'x中，');
      });
      expect(key).not.toHaveBeenCalled();
      expect(change.mock.calls).toEqual([['x中，']]);
      expect(textarea.value).toBe('x中，');
      expect(close).not.toHaveBeenCalled();
      await act(async () => render('x中，'));
      expect(host.querySelector('textarea')).toBe(textarea);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it.each([true, false])('accepts a final input after compositionend and synchronizes later document undo (display=%s)', async display => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host), change = vi.fn();
    const render = (value: string) => root.render(<FormulaSourceEditor value={value} display={display} onChange={change} onKeyDown={() => {}} onClose={() => {}}/>);
    try {
      await act(async () => render('x'));
      const textarea = host.querySelector('textarea')!;
      await act(async () => {
        textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        inputValue(textarea, 'x，', true);
        textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '，', bubbles: true }));
        inputValue(textarea, 'x，中');
      });
      expect(change.mock.calls).toEqual([['x，'], ['x，中']]);
      await act(async () => render('x，中'));
      await act(async () => render('x'));
      expect(textarea.value).toBe('x');
      expect(document.activeElement).toBe(textarea);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it('keeps the embedded block editor connected and commits one document change for a composition', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const editor = new Editor({ extensions: [StarterKit, MathInline, MathBlock],
      content: { type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'x' } }] } });
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host), update = vi.fn();
    try {
      await act(async () => root.render(<EditorContent editor={editor}/>));
      await act(async () => { host.querySelector('.math-node')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const textarea = host.querySelector('textarea')!, widget = textarea.closest('.embedded-source-editor')!;
      editor.on('update', update);
      await act(async () => {
        textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        inputValue(textarea, 'xzhong', true);
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      });
      expect(update).not.toHaveBeenCalled();
      expect(editor.state.doc.firstChild?.attrs.latex).toBe('x');
      expect(host.querySelector('textarea')).toBe(textarea);
      expect(document.activeElement).toBe(textarea);
      await act(async () => {
        inputValue(textarea, 'x中，', true);
        textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中，', bubbles: true }));
        inputValue(textarea, 'x中，');
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect(editor.state.doc.firstChild?.attrs.latex).toBe('x中，');
      expect(host.querySelector('.embedded-source-editor')).toBe(widget);
      expect(host.querySelector('textarea')).toBe(textarea);
      expect(document.activeElement).toBe(textarea);
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); });
      expect(host.querySelector('textarea')).toBeNull();
    } finally { await act(async () => root.unmount()); editor.destroy(); host.remove(); }
  });
});
