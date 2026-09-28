import type { Editor } from '@tiptap/core';

interface Pending {
  dom: HTMLElement;
  callbacks: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  finish: () => void;
}

const pending = new WeakMap<Editor, Pending>();

/** Presentation transactions must wait until ProseMirror has read the final IME DOM. */
export function afterCodeComposition(editor: Editor, callback: () => void): () => void {
  if (!editor.view.composing) {
    callback();
    return () => {};
  }
  let entry = pending.get(editor);
  if (!entry) {
    const dom = editor.view.dom;
    const callbacks = new Set<() => void>();
    const finish = () => {
      const current = pending.get(editor);
      if (!current || current.timer) return;
      // ProseMirror flushes its pending DOM mutations after compositionend.
      // Its follow-up composition cleanup also runs in a short timer.
      current.timer = setTimeout(() => {
        current.timer = undefined;
        if (editor.isDestroyed) { callbacks.clear(); cleanup(); return; }
        if (editor.view.composing) return;
        const ready = [...callbacks]; callbacks.clear(); cleanup();
        for (const run of ready) run();
      }, 25);
    };
    const cleanup = () => {
      dom.removeEventListener('compositionend', finish, true);
      if (entry?.timer) clearTimeout(entry.timer);
      pending.delete(editor);
    };
    entry = { dom, callbacks, finish };
    pending.set(editor, entry);
    dom.addEventListener('compositionend', finish, true);
  }
  entry.callbacks.add(callback);
  const owner = entry;
  return () => {
    owner.callbacks.delete(callback);
    if (!owner.callbacks.size && pending.get(editor) === owner) {
      owner.dom.removeEventListener('compositionend', owner.finish, true);
      if (owner.timer) clearTimeout(owner.timer);
      pending.delete(editor);
    }
  };
}
