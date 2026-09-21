import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey<number | null>('embedded-source-editor');
const hosts = new WeakMap<Editor, HTMLDivElement>();
const leases = new WeakMap<Editor, symbol>();

/** A transient UI widget before the containing text block; never document content. */
export function openEmbeddedEditor(editor: Editor, position: number): { host: HTMLDivElement; close: () => void } {
  let host = hosts.get(editor);
  if (!host) {
    host = document.createElement('div');
    host.className = 'embedded-source-editor';
    host.contentEditable = 'false';
    host.dataset.editorControl = 'true';
    hosts.set(editor, host);
    const element = host;
    editor.registerPlugin(new Plugin<number | null>({
      key,
      state: {
        init: () => null,
        apply(tr, value) {
          const request = tr.getMeta(key) as { position: number | null } | undefined;
          if (request) return request.position;
          if (value === null) return null;
          const mapped = tr.mapping.mapResult(value);
          const node = tr.doc.nodeAt(mapped.pos);
          return node && ['mathInline', 'mathBlock'].includes(node.type.name) ? mapped.pos : null;
        },
      },
      props: {
        decorations(state) {
          const pos = key.getState(state);
          if (pos == null || pos > state.doc.content.size) return DecorationSet.empty;
          const resolved = state.doc.resolve(pos);
          const before = resolved.parent.isTextblock && resolved.depth > 0 ? resolved.before() : pos;
          return DecorationSet.create(state.doc, [Decoration.widget(before, element, {
            key: 'embedded-source', side: -1, stopEvent: () => true, ignoreSelection: true,
          })]);
        },
      },
      view: () => ({ destroy: () => hosts.delete(editor) }),
    }));
  }
  editor.view.dispatch(editor.state.tr.setMeta(key, { position }).setMeta('addToHistory', false));
  const lease = Symbol(); leases.set(editor, lease);
  return { host, close: () => {
    if (leases.get(editor) === lease) closeEmbeddedEditor(editor, host!);
  } };
}

export function closeEmbeddedEditor(editor: Editor, host: HTMLElement) {
  if (!editor.isDestroyed && hosts.get(editor) === host) {
    editor.view.dispatch(editor.state.tr.setMeta(key, { position: null }).setMeta('addToHistory', false));
  }
}

export function isEmbeddedEditing(editor: Editor) { return key.getState(editor.state) != null; }
export function embeddedEditingPosition(editor: Editor) { return key.getState(editor.state) ?? null; }
