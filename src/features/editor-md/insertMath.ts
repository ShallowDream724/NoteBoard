import type { Editor, Range } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { runDiscreteEdit } from './discreteEdit';
import { mathContent } from './insertContentRecipes';
import { requestMathEditing } from './mathEditingRequest';

/** Explicit creation opens a blank source; replayed empty nodes stay passive. */
export function insertMath(editor: Editor, type: 'inline' | 'block', range?: Range): boolean {
  // TipTap's chain.focus() schedules a later frame that can steal textarea focus.
  editor.view.focus();
  return runDiscreteEdit(editor, chain => {
    if (range) chain.deleteRange(range);
    return chain.insertContent(mathContent(type)).command(({ tr }) => {
      const name = type === 'inline' ? 'mathInline' : 'mathBlock';
      const selection = tr.selection, before = selection.$from.nodeBefore;
      const pos = selection instanceof NodeSelection && selection.node.type.name === name ? selection.from
        : before?.type.name === name ? selection.from - before.nodeSize : null;
      if (pos !== null) requestMathEditing(tr, pos, 0);
      return true;
    });
  });
}
