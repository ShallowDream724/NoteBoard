import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory, history, redoDepth, undoDepth } from '@tiptap/pm/history';
import { EditorView } from '@tiptap/pm/view';
import { releaseNativeHistory, withNativeHistoryReset } from '../../src/features/editor-md/nativeHistory';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {} } });
describe('native history ownership', () => {
  it('releases duplicate history without replacing document, selection or unrelated plugin state', () => {
    const key = new PluginKey<object>('retainedRuntime');
    let mounted = 0, destroyed = 0;
    const runtime = new Plugin({ key, state: { init: () => ({}), apply: (_tr, value) => value },
      view: () => { mounted++; return { destroy: () => { destroyed++; } }; } });
    let state = EditorState.create({ schema, plugins: [withNativeHistoryReset(history()), runtime] });
    state = state.apply(closeHistory(state.tr).insertText('one', 1));
    state = state.apply(closeHistory(state.tr).insertText('two', 4));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
    const original = state, doc = state.doc, selection = state.selection, retained = key.getState(state);
    const view = new EditorView(document.createElement('div'), { state });
    expect(undoDepth(state)).toBe(2);
    expect(releaseNativeHistory(view)).toBe(true);
    expect(undoDepth(view.state)).toBe(0); expect(redoDepth(view.state)).toBe(0);
    expect(view.state.doc).toBe(doc); expect(view.state.selection).toBe(selection);
    expect(key.getState(view.state)).toBe(retained); expect(undoDepth(original)).toBe(2);
    expect(view.state.plugins).toBe(state.plugins); expect(mounted).toBe(1); expect(destroyed).toBe(0);
    view.dispatch(closeHistory(view.state.tr).insertText('next', 1));
    expect(undoDepth(view.state)).toBe(1);
    view.destroy(); expect(destroyed).toBe(1);
  });
  it('does not reconfigure an empty history', () => {
    const state = EditorState.create({ schema, plugins: [withNativeHistoryReset(history())] });
    const view = new EditorView(document.createElement('div'), { state });
    expect(releaseNativeHistory(view)).toBe(false); expect(view.state).toBe(state);
    view.destroy();
  });
});
