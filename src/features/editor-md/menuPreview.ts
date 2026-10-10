import type { Transaction } from '@tiptap/pm/state';

/** A menu-owned live preview may replace wrappers while keeping its row alive. */
export const EDITOR_MENU_PREVIEW_META = 'noteboard-editor-menu-preview';

export function mapMenuTarget(tr: Transaction, pos: number): number | null {
  const before = tr.before.nodeAt(pos), mapped = tr.mapping.mapResult(pos, 1);
  const after = tr.doc.nodeAt(mapped.pos);
  if (!mapped.deletedAcross && (!mapped.deleted || before?.type === after?.type && before?.content === after?.content)) return mapped.pos;
  if (!before || !tr.getMeta(EDITOR_MENU_PREVIEW_META)) return null;
  // The command restores the logical selection after replacing a list wrapper.
  // Check only that ancestor path, and retain the exact original row's content.
  const at = tr.selection.$from, selected = tr.doc.nodeAt(at.pos);
  if (before.type === selected?.type && before.content === selected.content) return at.pos;
  for (let depth = at.depth; depth > 0; depth--) {
    const node = at.node(depth);
    if (before.type === node.type && before.content === node.content) return at.before(depth);
  }
  return null;
}
