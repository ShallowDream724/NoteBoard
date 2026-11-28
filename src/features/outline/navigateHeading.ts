import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { revealEditorBlock } from '../editor-md/editorViewport';
import type { HeadingItem } from './headingIndex';
import { rememberReadingPlace } from './readingNavigation';

export function navigateHeading(editor: Editor, heading: HeadingItem) {
  if (editor.isDestroyed || heading.pos >= editor.state.doc.content.size) return null;
  const { state, view } = editor;
  const node = state.doc.nodeAt(heading.pos);
  if (node?.type.name !== 'heading' || node.textContent !== heading.text || node.attrs.level !== heading.level) return null;
  const target = TextSelection.near(state.doc.resolve(heading.pos + 1));
  const transaction = state.tr.setSelection(target);
  view.dispatch(rememberReadingPlace(editor, transaction));
  view.focus();
  return revealEditorBlock(view, heading.pos, 'start');
}
