import type { Fragment, Node, ResolvedPos } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { DISCRETE_EDIT_META } from './discreteEdit';
import { slashTriggerPosition } from './slashHistory';

function sameAncestors(before: ResolvedPos, after: ResolvedPos): boolean {
  if (before.depth !== after.depth) return false;
  for (let depth = 0; depth < before.depth; depth++) {
    if (!before.node(depth).sameMarkup(after.node(depth))) return false;
  }
  return true;
}

/** Only inspect the replaced slice, never the containing document or code body. */
function containsStructure(fragment: Fragment): boolean {
  for (let index = 0; index < fragment.childCount; index++) {
    const node = fragment.child(index);
    if (node.isText || node.type === node.type.schema.nodes.hardBreak) continue;
    if (node.type !== node.type.schema.nodes.paragraph) return true;
    if (containsStructure(node.content)) return true;
  }
  return false;
}

function changedStructure(before: Node, after: Node, a: number, b: number, c: number, d: number): boolean {
  const oldNode = before.nodeAt(a), newNode = after.nodeAt(c);
  // Attribute-backed source editors (formula, diagram, etc.) edit an existing
  // atom. Their input cadence still comes from the native history mechanism.
  if (oldNode?.isLeaf && !oldNode.isText && newNode?.type === oldNode.type
    && b - a === oldNode.nodeSize && d - c === newNode.nodeSize) return false;
  const oldFrom = before.resolve(a), oldTo = before.resolve(b);
  const newFrom = after.resolve(c), newTo = after.resolve(d);
  if (oldFrom.sameParent(oldTo) && newFrom.sameParent(newTo)
    && oldFrom.parent.isTextblock && newFrom.parent.isTextblock
    && oldFrom.parent.sameMarkup(newFrom.parent)
    && sameAncestors(oldFrom, newFrom)) {
    return containsStructure(before.slice(a, b).content) || containsStructure(after.slice(c, d).content);
  }
  // Splitting/joining ordinary paragraphs remains a normal typing gesture, but
  // a changed ancestor (wrap/lift/container conversion) is a structural action.
  const paragraph = before.type.schema.nodes.paragraph;
  if ([oldFrom, oldTo, newFrom, newTo].every(pos => pos.parent.type === paragraph)
    && sameAncestors(oldFrom, newFrom) && sameAncestors(oldTo, newTo)) {
    return containsStructure(before.slice(a, b).content) || containsStructure(after.slice(c, d).content);
  }
  return true;
}

export function changesDocumentStructure(tr: Transaction): boolean {
  for (let index = 0; index < tr.steps.length; index++) {
    const before = tr.docs[index], after = tr.docs[index + 1] ?? tr.doc;
    let structural = false;
    tr.steps[index].getMap().forEach((a, b, c, d) => { structural ||= changedStructure(before, after, a, b, c, d); });
    if (structural) return true;
  }
  return false;
}

/** One per editor. Native history supplies timing; semantic actions isolate both
 * sides of the application's single timeline even if a command omits a marker. */
export class VisualHistoryGrouping {
  private isolateNext = false;
  private slashFrom: number | null = null;
  private slashCaret = 0;
  private commandInProgress = false;

  startsNewGroup(tr: Transaction, nativeBoundary: boolean, slashCommandAction = false): boolean {
    if (tr.getMeta('noteboard-document-replacement')) {
      this.slashFrom = null;
      this.commandInProgress = false;
      return false;
    }
    if (!tr.docChanged || tr.getMeta('addToHistory') === false) return false;

    if (slashCommandAction) {
      // The trigger and all synchronous edits of its command are one action.
      // If an action is invoked without an observed trigger, isolate its first edit.
      const boundary = this.slashFrom === null && !this.commandInProgress;
      this.commandInProgress = true;
      this.slashFrom = null;
      this.isolateNext = true;
      return boundary;
    }
    this.commandInProgress = false;
    const trigger = slashTriggerPosition(tr);
    if (trigger !== null) {
      this.slashFrom = trigger;
      this.slashCaret = tr.selection.from;
      this.isolateNext = false;
      return true;
    }
    if (this.slashFrom !== null) {
      const from = this.slashFrom;
      const previousCaret = this.slashCaret;
      const editsQuery = tr.steps.every(step => {
        let inQuery = true;
        step.getMap().forEach((oldFrom, oldTo) => { inQuery &&= oldFrom >= from && oldTo <= previousCaret; });
        return inQuery;
      });
      const caret = tr.selection.from;
      const query = caret > from && caret <= tr.doc.content.size
        ? tr.doc.textBetween(from, caret) : '';
      if (editsQuery && tr.selection.empty && /^\/[^\s]*$/.test(query)) {
        this.slashCaret = caret;
        return false;
      }
      this.slashFrom = null;
    }
    const isolated = !!tr.getMeta(DISCRETE_EDIT_META) || changesDocumentStructure(tr);
    const boundary = isolated || this.isolateNext || nativeBoundary;
    this.isolateNext = isolated;
    return boundary;
  }
}
