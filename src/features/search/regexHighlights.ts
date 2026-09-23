import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { sourceSearchIndex } from './sourceSearchSnapshot';

export const setRegexRanges = StateEffect.define<Uint32Array>();
const regexRanges = StateField.define<Uint32Array>({
  create: () => new Uint32Array(),
  update(ranges, tr) {
    for (const effect of tr.effects) if (effect.is(setRegexRanges)) return effect.value;
    return tr.docChanged ? new Uint32Array() : ranges;
  },
});
const installed = new WeakSet<EditorView>();

/** Regex never enters CodeMirror's synchronous regexp cursor. Only the worker
 * index is retained; this plugin materializes at most 2000 visible marks. */
export function installRegexHighlights(view: EditorView, changed: () => void, destroyed: () => void) {
  if (installed.has(view)) return;
  installed.add(view);
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    active: DecorationSet;
    constructor(readonly view: EditorView) { this.decorations = this.build(); this.active = this.current(); }
    build() {
      const ranges = this.view.state.field(regexRanges), marks: Array<{ from: number; to: number; value: Decoration }> = [];
      const seen = new Set<number>();
      for (const visible of this.view.visibleRanges) {
        const from = Math.max(0, visible.from - 2000), to = visible.to + 2000;
        let low = 0, high = ranges.length / 2;
        while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid * 2 + 1] < from) low = mid + 1; else high = mid; }
        for (let index = low; index < ranges.length / 2 && ranges[index * 2] <= to && marks.length < 2000; index++) {
          if (seen.has(index) || ranges[index * 2] === ranges[index * 2 + 1]) continue;
          seen.add(index);
          marks.push({ from: ranges[index * 2], to: ranges[index * 2 + 1], value: Decoration.mark({ class: 'cm-searchMatch' }) });
        }
      }
      return Decoration.set(marks.map(mark => mark.value.range(mark.from, mark.to)), true);
    }
    current() {
      const selection = this.view.state.selection.main;
      const index = sourceSearchIndex(this.view.state.field(regexRanges), selection.from, selection.to);
      return index && !selection.empty ? Decoration.set([Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' }).range(selection.from, selection.to)]) : Decoration.none;
    }
    update(update: ViewUpdate) {
      const rangesChanged = update.docChanged || update.transactions.some(tr => tr.effects.some(effect => effect.is(setRegexRanges)));
      if (rangesChanged || update.viewportChanged) this.decorations = this.build();
      if (rangesChanged || update.selectionSet) this.active = this.current();
      if (update.docChanged) queueMicrotask(changed);
    }
    destroy() { destroyed(); }
  }, { decorations: value => value.decorations });
  view.dispatch({ effects: StateEffect.appendConfig.of([regexRanges, plugin, EditorView.decorations.of(current => current.plugin(plugin)?.active ?? Decoration.none)]) });
}
