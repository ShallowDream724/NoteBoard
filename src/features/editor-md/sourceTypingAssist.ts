import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { Prec, type EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { customCodeMirrorShortcuts } from '../../core/editor/customShortcuts';
import { ALERT_META, matchAlertChoices } from './alertPresentation';
import { normalizeAlertInput } from './calloutPresentation';
import { clearSourceTextFormatting, formatSourceMark, setSourceHeading, runSourceFormatCommand } from './sourceFormatting';

function insideCode(state: EditorState, position: number) {
  for (let node = syntaxTree(state).resolveInner(position, -1); node; node = node.parent!) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return true;
  }
  return false;
}

/** Source-mode adapters reuse the same Markdown vocabulary, with CM owning completion/focus. */
export const sourceTypingAssist = [
  customCodeMirrorShortcuts('source', (view, id) => {
    if (id === 'markdown.clearStyles') return clearSourceTextFormatting(view);
    const level = /^markdown\.heading([0-6])$/.exec(id)?.[1];
    if (level !== undefined) return setSourceHeading(view, Number(level));
    return runSourceFormatCommand(view, id);
  }),
  Prec.high(keymap.of([
    { key: 'Mod-u', run: view => formatSourceMark(view, 'underline') },
    { key: 'Tab', run: acceptCompletion },
    { key: 'Enter', run: view => {
      const { from, empty } = view.state.selection.main, line = view.state.doc.lineAt(from);
      if (view.composing || !empty || from !== line.to || line.text !== '···' || insideCode(view.state, from)) return false;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '```\n\n```' }, selection: { anchor: line.from + 4 }, annotations: isolateHistory.of('full'), scrollIntoView: true });
      return true;
    } },
  ])),
  autocompletion({ activateOnTypingDelay: 0, interactionDelay: 0, override: [context => {
    const line = context.state.doc.lineAt(context.pos);
    if (line.length > 20 || insideCode(context.state, context.pos)) return null;
    const match = /^(>\s*)?\[!([a-z]*)\]?$/i.exec(normalizeAlertInput(line.text.slice(0, context.pos - line.from)));
    if (!match || !/^(?:\]|)$/.test(normalizeAlertInput(context.state.sliceDoc(context.pos, line.to)))) return null;
    return { from: line.from + (match[1]?.length ?? 0), to: line.to, filter: false,
      options: matchAlertChoices(match[2]).map(item => ({ label: ALERT_META[item.kind].label, detail: item.description,
        apply: view => {
          const prefix = match[1] || '> ', insert = `${prefix}[!${item.kind.toUpperCase()}]\n${prefix}`;
          view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, annotations: isolateHistory.of('full'), scrollIntoView: true });
        } })),
    };
  }] }),
];
