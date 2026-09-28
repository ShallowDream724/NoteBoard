import type { Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

interface MathEditingRequest { pos: number; anchor: number; head: number; token: object }
const key = new PluginKey<MathEditingRequest | null>('math-editing-request');
const consumed = new WeakSet<object>();

/** Focus handoff is transient editor state, never a persisted math attribute. */
export function requestMathEditing(tr: Transaction, pos: number, anchor: number, head = anchor) {
  tr.setMeta(key, { pos, anchor, head, token: {} } satisfies MathEditingRequest);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
}

export function consumeMathEditingRequest(editor: Editor, pos: number) {
  const request = key.getState(editor.state);
  if (!request || request.pos !== pos || consumed.has(request.token)) return null;
  consumed.add(request.token);
  return { anchor: request.anchor, head: request.head };
}

export function mathEditingRequestPlugin() {
  return new Plugin<MathEditingRequest | null>({ key, state: {
    init: () => null,
    apply(tr, previous) {
      const requested = tr.getMeta(key) as MathEditingRequest | undefined;
      if (requested) return requested;
      if (!previous || consumed.has(previous.token)) return null;
      const pos = tr.mapping.map(previous.pos);
      const node = tr.doc.nodeAt(pos);
      if (!node || !['mathInline', 'mathBlock'].includes(node.type.name)
        || tr.selectionSet && (!(tr.selection instanceof NodeSelection) || tr.selection.from !== pos)) return null;
      return pos === previous.pos ? previous : { ...previous, pos };
    },
  } });
}
