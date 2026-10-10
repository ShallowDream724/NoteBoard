import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { changesDocumentStructure } from '../visualHistoryGrouping';
import { normalizeNumbering } from './model';
import { settleNumberingDraft } from './session';
import { Mapping } from '@tiptap/pm/transform';

export const NUMBERING_OPERATION = 'noteboard-numbering-operation';
export const ListNumbering = Extension.create({
  name: 'listNumbering', priority: 1100,
  dispatchTransaction({ transaction, next }) {
    // Finish the preview before an async insert or another command mutates its
    // document. Commit produces the same document/positions as the preview, so
    // the incoming transaction remains valid and no inverse overwrites it.
    if (transaction.docChanged && !transaction.getMeta(NUMBERING_OPERATION)) settleNumberingDraft(this.editor);
    next(transaction);
  },
  addKeyboardShortcuts() {
    return { Backspace: () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parentOffset !== 0 || this.editor.view.composing) return false;
      const at = selection.$from;
      if (at.depth < 2 || !['listItem', 'taskItem'].includes(at.node(-1).type.name) || at.index(-1) !== 0) return false;
      // Nested lists first outdent one level. At the outer level, remove the
      // current marker without joining its text to the preceding item.
      return at.depth > 3 && ['listItem', 'taskItem'].includes(at.node(-3).type.name)
        ? this.editor.commands.liftListItem(at.node(-1).type.name) : this.editor.commands.restoreParagraph();
    } };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('listNumbering'), appendTransaction(transactions, old, state) {
      if (!transactions.some(tr => tr.docChanged && !tr.getMeta(NUMBERING_OPERATION) && !tr.getMeta('noteboard-document-replacement') && changesDocumentStructure(tr))) return null;
      const mapping = new Mapping(); transactions.forEach(tr => mapping.appendMapping(tr.mapping));
      const tr = state.tr; normalizeNumbering(tr, old.doc, mapping);
      return tr.docChanged ? tr.setMeta(NUMBERING_OPERATION, true) : null;
    } })];
  },
});
