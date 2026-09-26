import { useLayoutEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

interface Presentation { collapsed: boolean; wrap: boolean }
const editors = new WeakMap<Editor, WeakMap<Node, Presentation>>();
/** Reordering reinserts the same immutable node. Presentation survives a
 * NodeView remount, without attributes leaking into Markdown or exports. */
export function useCodeViewState(editor: Editor, node: Node) {
  let states = editors.get(editor);
  if (!states) { states = new WeakMap(); editors.set(editor, states); }
  const [collapsed, setCollapsed] = useState(() => states.get(node)?.collapsed ?? false);
  const [wrap, setWrap] = useState(() => states.get(node)?.wrap ?? true);
  useLayoutEffect(() => { states.set(node, { collapsed, wrap }); }, [states, node, collapsed, wrap]);
  return { collapsed, setCollapsed, wrap, setWrap };
}
