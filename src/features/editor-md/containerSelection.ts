import { commands, Extension } from '@tiptap/core';
import { Slice, type Node } from '@tiptap/pm/model';
import { AllSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { showToast } from '../../stores/toastStore';

// User-facing editing scopes, not arbitrary schema wrappers such as tableRow.
const containers = new Set(['githubAlert', 'disclosure', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'table', 'imageCollection']);

/** Exact content boundaries include leading/trailing atoms. TextSelection.between
 * would silently omit an image at either end of a rich container. */
export class ContainerContentSelection extends Selection {
  constructor(doc: Node, readonly containerPos: number) {
    const node = doc.nodeAt(containerPos)!;
    super(doc.resolve(containerPos + 1), doc.resolve(containerPos + node.nodeSize - 1));
  }
  eq(other: Selection): boolean { return other instanceof ContainerContentSelection && this.from === other.from && this.to === other.to; }
  map(doc: Node, mapping: Mappable): Selection { return this.getBookmark().map(mapping).resolve(doc); }
  toJSON() { return { type: 'containerContent', pos: this.containerPos }; }
  static fromJSON(doc: Node, json: { pos: number }): Selection { return new ContainerContentBookmark(json.pos).resolve(doc); }
  getBookmark() { return new ContainerContentBookmark(this.containerPos); }
  replace(tr: Transaction, content = Slice.empty) {
    if (content.size) { super.replace(tr, content); return; }
    const node = tr.doc.nodeAt(this.containerPos)!;
    const empty = node.type.createAndFill(node.attrs);
    if (!empty) return;
    tr.replaceWith(this.from, this.to, empty.content);
    tr.setSelection(Selection.near(tr.doc.resolve(this.from)));
  }
}
class ContainerContentBookmark {
  constructor(readonly pos: number, readonly deleted = false) {}
  map(mapping: Mappable) { const mapped = mapping.mapResult(this.pos, 1); return new ContainerContentBookmark(mapped.pos, this.deleted || mapped.deletedAcross); }
  resolve(doc: Node): Selection {
    const pos = Math.max(0, Math.min(this.pos, doc.content.size)), node = doc.nodeAt(pos);
    return !this.deleted && node && containers.has(node.type.name) && !node.isTextblock
      ? new ContainerContentSelection(doc, pos) : Selection.near(doc.resolve(pos));
  }
}
Selection.jsonID('containerContent', ContainerContentSelection);

export function currentContainerSelection(selection: Selection): Selection | null {
  if (selection instanceof AllSelection) return null;
  const { $from, to } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth), start = $from.start(depth), end = $from.end(depth);
    if (!containers.has(node.type.name) || to > end) continue;
    if (node.type.name === 'codeBlock') return TextSelection.create($from.doc, start, end);
    if (node.type.name === 'table') {
      const map = TableMap.get(node);
      return CellSelection.create($from.doc, start + map.map[0], start + map.map[map.map.length - 1]);
    }
    return new ContainerContentSelection($from.doc, $from.before(depth));
  }
  return null;
}

const containerSelectionKey = new PluginKey<Selection | null>('containerSelectAll');
// TipTap's default command uses deleteRange (which may lift empty wrappers),
// bypassing Selection.replace. Other selection types retain its normal behavior.
const ContainerContentCommands = Extension.create({
  name: 'containerContentCommands', priority: 90,
  addCommands() {
    return { deleteSelection: () => props => {
      if (!(props.state.selection instanceof ContainerContentSelection)) return commands.deleteSelection()(props);
      if (props.dispatch) props.tr.deleteSelection();
      return true;
    } };
  },
});
export const ContainerSelectAll = Extension.create({
  name: 'containerSelectAll', priority: 1100,
  addExtensions() { return [ContainerContentCommands]; },
  addProseMirrorPlugins() {
    return [new Plugin<Selection | null>({
      key: containerSelectionKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          if (tr.getMeta(containerSelectionKey) !== undefined) return tr.getMeta(containerSelectionKey) ? tr.selection : null;
          return tr.docChanged || (tr.selectionSet && !previous?.eq(tr.selection)) ? null : previous;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (view.composing || event.key.toLowerCase() !== 'a' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
          event.preventDefault();
          // Holding the keys must not escalate an initial local selection.
          if (event.repeat) return true;
          const { state } = view, previous = containerSelectionKey.getState(state);
          const scope = previous?.eq(state.selection) ? null : currentContainerSelection(state.selection);
          view.dispatch(state.tr.setSelection(scope ?? new AllSelection(state.doc)).setMeta(containerSelectionKey, !!scope));
          if (scope) showToast(`已选中容器内的内容，再按一次 ${event.metaKey ? '⌘A' : 'Ctrl+A'} 全选全文`, 'info', 2500);
          return true;
        },
        handleDOMEvents: {
          mousedown(view) { if (containerSelectionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(containerSelectionKey, false)); return false; },
          blur(view) { if (containerSelectionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(containerSelectionKey, false)); return false; },
        },
      },
    })];
  },
});
