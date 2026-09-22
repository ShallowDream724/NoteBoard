import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { indentMore, undoDepth } from '@codemirror/commands';
import { createBaseExtensions, editorDisplayEffects } from '../../src/features/editor-code/setup';

describe('CodeMirror editor setting contract', () => {
  it('uses the configured width for inserted spaces, then switches to tab characters without replacing state history', () => {
    let state = EditorState.create({ doc: 'line', extensions: createBaseExtensions({ tabSize: 4, insertSpaces: true }) });
    const indent = () => indentMore({ state, dispatch: transaction => { state = transaction.state; } });
    expect(state.tabSize).toBe(4); expect(state.facet(indentUnit)).toBe('    ');
    indent(); expect(state.doc.toString()).toBe('    line');
    const selection = state.selection, historyDepth = undoDepth(state), document = state.doc;
    state = state.update({ effects: editorDisplayEffects({ tabSize: 4, insertSpaces: false, showIndentGuides: true }) }).state;
    expect(state.doc).toBe(document); expect(state.selection.eq(selection)).toBe(true); expect(undoDepth(state)).toBe(historyDepth);
    expect(state.facet(indentUnit)).toBe('\t');
    indent(); expect(state.doc.toString()).toBe('\t    line');
  });

  it('constrains imported invalid tab widths to the existing supported setting range', () => {
    expect(EditorState.create({ extensions: createBaseExtensions({ tabSize: 100 }) }).tabSize).toBe(8);
    expect(EditorState.create({ extensions: createBaseExtensions({ tabSize: -1 }) }).tabSize).toBe(1);
    expect(EditorState.create({ extensions: createBaseExtensions({ tabSize: NaN }) }).tabSize).toBe(2);
  });
});
