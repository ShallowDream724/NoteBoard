import Link from '@tiptap/extension-link';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { MarkType } from '@tiptap/pm/model';

/** A link ends at its last character. Autolinking and explicit stored marks
 * still work; ProseMirror handles insertion inside links and composition. */
export const ProseLink = Link.extend({
  inclusive: false,
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createProseLinkReplacementPlugin(this.type)];
  },
});

/** Standalone embedded views use the same replacement behavior as Tiptap. */
export function createProseLinkReplacementPlugin(type: MarkType) {
    const key = new PluginKey('proseLinkReplacement');
    return new Plugin({ key, appendTransaction(transactions, before, after) {
      const selection = before.selection;
      if (selection.empty || !selection.$from.sameParent(selection.$to) || transactions.some(tr => tr.getMeta(key))) return;
      const link = selection.$from.nodeAfter?.marks.find(mark => mark.type === type);
      if (!link || (before.storedMarks && !before.storedMarks.some(mark => mark.eq(link)))) return;
      let contained = true;
      before.doc.nodesBetween(selection.from, selection.to, node => {
        if (node.isInline && !node.marks.some(mark => mark.eq(link))) contained = false;
      });
      if (!contained) return;
      const changes = transactions.flatMap(tr => tr.steps);
      if (changes.length !== 1) return;
      const step = changes[0];
      if (!(step instanceof ReplaceStep) || step.from !== selection.from || step.to !== selection.to || !step.slice.size) return;
      let textOnly = true, explicitLink = false;
      step.slice.content.forEach(node => {
        if (!node.isText) textOnly = false;
        if (node.marks.some(mark => mark.type === type)) explicitLink = true;
      });
      if (!textOnly || explicitLink) return;
      const tr = after.tr.addMark(step.from, step.from + step.slice.size, link).setMeta(key, true);
      return tr.steps.length ? tr : undefined;
    } });
}
