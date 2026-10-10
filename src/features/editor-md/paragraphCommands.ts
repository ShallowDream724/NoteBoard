import { CommandManager, Extension } from '@tiptap/core';
import { Fragment, type Node } from '@tiptap/pm/model';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { isList } from './listItemActions';
import { discreteTransaction } from './discreteEdit';
import { paragraphRestoration } from './paragraphRestoration';
import { RESTORABLE_TEXT_CONTAINERS } from './textContainerRestoration';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStructure: { restoreParagraph: () => ReturnType };
  }
}

/** Explicit user action; ordinary setParagraph keeps its low-level meaning. */
export const ParagraphCommands = Extension.create({
  name: 'paragraphStructure',
  addCommands() {
    return { restoreParagraph: () => ({ state, tr, dispatch, editor }) => {
      if (!dispatch) {
        // can() inside a chain shares that chain's transaction. Validate on an
        // isolated state reusing immutable nodes, never mutate the caller's tr.
        const isolated = EditorState.create({ schema: state.schema, doc: state.doc, selection: state.selection, storedMarks: state.storedMarks });
        return new CommandManager({ editor, state: isolated }).commands.restoreParagraph();
      }
      const selection = state.selection;
      const planner = paragraphRestoration(selection), plans: { pos: number; node: Node; nodes: Node[] }[] = [];
      if (selection instanceof CellSelection) {
        for (const { $from } of selection.ranges) {
          const node = $from.parent, pos = $from.before(), nodes = planner.rewrite(node, pos);
          if (nodes.length !== 1 || nodes[0] !== node) plans.push({ pos, node, nodes });
        }
      } else state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (['annotationStore', 'documentPresentation'].includes(node.type.name)) return false;
        if (isList(node) || node.type.name === 'blockquote' || node.isTextblock || RESTORABLE_TEXT_CONTAINERS.has(node.type.name)) {
          const nodes = planner.rewrite(node, pos);
          if (nodes.length !== 1 || nodes[0] !== node) plans.push({ pos, node, nodes });
          return false;
        }
      });
      if (!planner.isValid()) return false;
      for (const plan of plans) {
        const at = state.doc.resolve(plan.pos);
        if (!at.parent.canReplace(at.index(), at.index() + 1, Fragment.fromArray(plan.nodes))) return false;
      }
      if (!plans.length) return true;
      if (selection instanceof CellSelection) {
        // The grid is unchanged. Copy each touched cell/row once rather than
        // repeatedly replacing ancestors for a thousand-cell rectangle.
        const tablePos = selection.$anchorCell.before(-1), table = state.doc.nodeAt(tablePos)!;
        const oldMap = TableMap.get(table), start = tablePos + 1;
        const anchor = oldMap.findCell(selection.$anchorCell.pos - start), head = oldMap.findCell(selection.$headCell.pos - start);
        const patches = new Map(plans.map(plan => [plan.pos - start, plan.nodes[0]]));
        const rows: Node[] = [];
        table.forEach((row, rowPos) => {
          const cells: Node[] = []; let changed = false;
          row.forEach((cell, cellPos) => { const next = patches.get(rowPos + 1 + cellPos) ?? cell; cells.push(next); changed ||= next !== cell; });
          rows.push(changed ? row.copy(Fragment.fromArray(cells)) : row);
        });
        const next = table.copy(Fragment.fromArray(rows)), map = TableMap.get(next);
        tr.replaceWith(tablePos, tablePos + table.nodeSize, next);
        tr.setSelection(CellSelection.create(tr.doc, start + map.positionAt(anchor.top, anchor.left, next), start + map.positionAt(head.top, head.left, next)));
        discreteTransaction(tr); return true;
      }
      let original = selection;
      if (selection instanceof NodeSelection) {
        let from: number | undefined, to: number | undefined;
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (node.isTextblock) { from ??= pos + 1; to = pos + node.nodeSize - 1; return false; }
        });
        if (from !== undefined && to !== undefined) original = TextSelection.create(state.doc, from, to);
      }
      const mappingStart = tr.mapping.maps.length, marks = state.storedMarks ?? selection.$from.marks();
      for (const plan of plans.sort((a, b) => b.pos - a.pos)) tr.replaceWith(plan.pos, plan.pos + plan.node.nodeSize, Fragment.fromArray(plan.nodes));
      const localMapping = tr.mapping.slice(mappingStart);
      if (selection instanceof AllSelection) tr.setSelection(new AllSelection(tr.doc));
      else {
        let anchor: number | undefined, head: number | undefined;
        const first = plans.at(-1)!, last = plans[0];
        tr.doc.nodesBetween(localMapping.map(first.pos, -1), localMapping.map(last.pos + last.node.nodeSize, 1), (node, pos) => {
          if (node === planner.blockFor(original.$anchor.parent)) anchor = pos + 1 + original.$anchor.parentOffset;
          if (node === planner.blockFor(original.$head.parent)) head = pos + 1 + original.$head.parentOffset;
          if (node.isTextblock) return false;
        });
        tr.setSelection(TextSelection.between(tr.doc.resolve(anchor ?? localMapping.map(original.anchor)), tr.doc.resolve(head ?? localMapping.map(original.head))));
        if (selection.empty) tr.ensureMarks(marks);
      }
      discreteTransaction(tr); return true;
    } };
  },
});
