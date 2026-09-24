import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { AlertKind } from './alertPresentation';

/** Replace only the marker's quote and enter its body, preserving the surrounding document. */
export function completeAlert(editor: Editor, kind: AlertKind): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 2 || $from.parent.type.name !== 'paragraph'
    || $from.node(-1).type.name !== 'blockquote' || $from.node(-1).childCount !== 1) return false;
  const pos = $from.before($from.depth - 1);
  const tr = closeHistory(state.tr).replaceWith(pos, $from.after($from.depth - 1),
    state.schema.nodes.githubAlert.create({ kind }, state.schema.nodes.paragraph.create()));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView());
  view.focus();
  return true;
}
