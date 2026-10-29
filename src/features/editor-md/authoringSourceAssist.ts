import type { CompletionSource } from '@codemirror/autocomplete';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { authoringRegistry, commandSpec } from '../declarative/registry';

/** Completion reads the parser's catalog; adding a language command updates both
 * visual typing and the retained source editor without another keyword table. */
export const authoringCompletionSource: CompletionSource = context => {
  for (let node = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent!) {
    if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return null;
  }
  const line = context.state.doc.lineAt(context.pos), before = line.text.slice(0, context.pos - line.from);
  const block = /^(\s*:::\s*)([a-z]*)$/i.exec(before), inline = /\\([a-z]*)$/i.exec(before);
  if (block || inline) {
    const prefix = block?.[2] ?? inline![1], from = block ? line.from + block[1].length : context.pos - prefix.length;
    return { from, validFor: /^[a-z]*$/i, options: (block ? authoringRegistry.block : authoringRegistry.inline).filter(spec => !spec.internal).map(spec => ({
      label: spec.name, detail: spec.description, type: 'keyword',
      apply: (view, _completion, start, end) => {
        const insert = block ? spec.example.replace(/^:::\s*/, '') : spec.example.slice(1);
        const placeholder = insert.indexOf('内容'), newline = insert.indexOf('\n');
        const anchor = start + (placeholder >= 0 ? placeholder : newline >= 0 ? newline + 1 : insert.length);
        view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor, head: placeholder >= 0 ? anchor + 2 : anchor }, annotations: isolateHistory.of('full'), scrollIntoView: true });
      },
    })) };
  }
  const params = /^\s*:::\s*([a-z]+)\s+.*?([a-z-]*)$/i.exec(before);
  const spec = params ? commandSpec(params[1], true) : null;
  if (!spec || !params) return null;
  return { from: context.pos - params[2].length, validFor: /^[a-z-]*$/i, options: spec.fields.map(field => ({ label: field, apply: field + '=', type: 'property' })) };
};
