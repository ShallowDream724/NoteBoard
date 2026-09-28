import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

type EmbeddedEditing = { position: number; inlineHost?: HTMLElement };
const key = new PluginKey<EmbeddedEditing | null>('embedded-source-editor');
const hosts = new WeakMap<Editor, HTMLDivElement>();
const leases = new WeakMap<Editor, symbol>();

/** One source/history session, hosted inline or in a transient block widget. */
export function openEmbeddedEditor(editor: Editor, position: number, inlineHost?: HTMLElement): { host: HTMLElement; close: () => void } {
  let host = hosts.get(editor);
  if (!host) {
    host = document.createElement('div');
    host.className = 'embedded-source-editor';
    host.contentEditable = 'false';
    host.dataset.editorControl = 'true';
    hosts.set(editor, host);
    const element = host;
    editor.registerPlugin(new Plugin<EmbeddedEditing | null>({
      key,
      state: {
        init: () => null,
        apply(tr, value) {
          const request = tr.getMeta(key) as { position: number | null; inlineHost?: HTMLElement } | undefined;
          if (request) return request.position === null ? null : { position: request.position, inlineHost: request.inlineHost };
          if (value === null) return null;
          const mapped = tr.mapping.mapResult(value.position);
          const node = tr.doc.nodeAt(mapped.pos);
          return node && ['mathInline', 'mathBlock'].includes(node.type.name) ? { ...value, position: mapped.pos } : null;
        },
      },
      props: {
        decorations(state) {
          const active = key.getState(state);
          if (!active || active.inlineHost || active.position > state.doc.content.size) return DecorationSet.empty;
          const pos = active.position;
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
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta(key, { position, inlineHost }).setMeta('addToHistory', false));
  const lease = Symbol(); leases.set(editor, lease);
  return { host: inlineHost ?? host, close: () => {
    if (leases.get(editor) === lease) closeEmbeddedEditor(editor, host!);
  } };
}

export function closeEmbeddedEditor(editor: Editor, host: HTMLElement) {
  if (!editor.isDestroyed && hosts.get(editor) === host) {
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta(key, { position: null }).setMeta('addToHistory', false));
  }
}

export function isEmbeddedEditing(editor: Editor) { return key.getState(editor.state) != null; }
export function embeddedEditingPosition(editor: Editor) { return key.getState(editor.state)?.position ?? null; }
