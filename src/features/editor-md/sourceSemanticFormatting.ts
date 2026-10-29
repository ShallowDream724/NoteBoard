import type { EditorView } from '@codemirror/view';
import { EditorState as DocumentState } from '@tiptap/pm/state';
import type { Node as DocumentNode, MarkType } from '@tiptap/pm/model';
import { documentParser } from './documentExtensions';
import { parseAuthoring, rememberAuthoringSource, inheritAuthoringSource, serializeAuthoring, type AuthoringSpan } from '../declarative/authoring';
import { readStyledSource } from '../document-style/sourceStyleTracking';
import { captureAuthoringSelection, authoringToVisual, visualToAuthoring } from './authoringSourcePosition';
import { readInlineCommand } from '../declarative/syntax';

interface Leaf { node: DocumentNode; from: number; to: number; opaque: boolean }
export interface SourceFormatSnapshot { text: EditorView['state']['doc']; source: string; doc: DocumentNode; spans: AuthoringSpan[]; leaves: Map<string, Leaf> }
const snapshots = new WeakMap<EditorView, SourceFormatSnapshot>();
export function sourceFormatSnapshot(view: EditorView, parse = false): SourceFormatSnapshot | null {
  const cached = snapshots.get(view); if (cached?.text === view.state.doc) return cached;
  if (!parse) return null;
  const source = readStyledSource(view.state), parsed = parseAuthoring(source), { schema } = documentParser();
  const doc = schema.nodeFromJSON(parsed.document); rememberAuthoringSource(doc, parsed);
  const leaves = new Map<string, Leaf>();
  const visit = (node: DocumentNode, from: number, path: number[], opaque = false) => {
    opaque ||= ['codeBlock', 'authoringRaw'].includes(node.type.name);
    if (node.isText) leaves.set(path.join('/'), { node, from, to: from + node.nodeSize, opaque });
    node.forEach((child, offset, index) => visit(child, from + 1 + offset, [...path, index], opaque));
  };
  visit(doc, -1, []);
  const snapshot = { text: view.state.doc, source, doc, spans: parsed.spans, leaves }; snapshots.set(view, snapshot); return snapshot;
}

/** Only semantic text payloads or exact node boundaries can own formatting.
 * Parameters, destinations and opaque code/formula payloads have no inline range. */
export function sourceFormatRange(view: EditorView, snapshot: SourceFormatSnapshot, range: { from: number; to: number } = view.state.selection.main, allowCode = false) {
  const spans = snapshot.spans.filter(span => span.kind === 'text' && snapshot.leaves.has(span.path.join('/')));
  const eligible = (span: AuthoringSpan) => { const leaf = snapshot.leaves.get(span.path.join('/'))!; return !leaf.opaque && (allowCode || !leaf.node.marks.some(mark => mark.type.name === 'code')); };
  const endpoint = (point: number, end: boolean) => {
    let span = spans.find(span => eligible(span) && point >= (span.contentFrom ?? span.from) && point <= (span.contentTo ?? span.to));
    if (span) return point;
    const wrappers = snapshot.spans.filter(span => span.kind === 'node' && point === (end ? span.to : span.from));
    for (const wrapper of wrappers.sort((a, b) => b.path.length - a.path.length)) {
      const children = spans.filter(span => eligible(span) && span.from >= wrapper.from && span.to <= wrapper.to);
      span = end ? children.at(-1) : children[0]; if (span) return end ? span.contentTo ?? span.to : span.contentFrom ?? span.from;
    }
    return null;
  };
  const from = endpoint(range.from, false), to = endpoint(range.to, true);
  if (from === null || to === null) return null;
  const mapped = authoringToVisual(snapshot.doc, captureAuthoringSelection(snapshot.spans, { anchor: from, head: to }));
  const leaves = [...snapshot.leaves.values()].filter(leaf => !leaf.opaque && (allowCode || !leaf.node.marks.some(mark => mark.type.name === 'code')) && leaf.from < mapped.head && leaf.to > mapped.anchor);
  if (mapped.anchor === mapped.head) {
    const leaf = [...snapshot.leaves.values()].find(leaf => !leaf.opaque && leaf.from <= mapped.anchor && leaf.to >= mapped.anchor && (allowCode || !leaf.node.marks.some(mark => mark.type.name === 'code')));
    return leaf ? { from: mapped.anchor, to: mapped.head, leaves: [leaf] } : null;
  }
  return leaves.length ? { from: mapped.anchor, to: mapped.head, leaves } : null;
}

export function hasSelectedDeclarativeFormatting(snapshot: SourceFormatSnapshot, from: number, to: number) {
  const styles = new Set(['bold', 'italic', 'strike', 'underline', 'textColor', 'highlight']);
  const payloads = snapshot.spans.filter(span => span.kind === 'text' && span.to >= from && span.from <= to && (() => {
    const leaf = snapshot.leaves.get(span.path.join('/'));
    return leaf && !leaf.opaque && !leaf.node.marks.some(mark => mark.type.name === 'code') && leaf.node.marks.some(mark => styles.has(mark.type.name));
  })());
  if (!payloads.length) return false;
  for (let at = snapshot.source.indexOf('\\'); at >= 0; at = snapshot.source.indexOf('\\', at + 1)) {
    const command = readInlineCommand(snapshot.source.slice(at));
    if (!command || command.error || !['b', 'i', 's', 'u', 'color', 'bg'].includes(command.name)) continue;
    const group = command.groups[0];
    if (group && payloads.some(span => span.from >= at + group.from && span.to <= at + group.to)) return true;
  }
  return false;
}

export function sourceParameterSelection(snapshot: SourceFormatSnapshot, from: number, to: number) {
  const lineStart = snapshot.source.lastIndexOf('\n', from - 1) + 1;
  const newline = snapshot.source.indexOf('\n', from), lineEnd = newline < 0 ? snapshot.source.length : newline;
  if (to <= lineEnd && /^ {0,3}:{3,}[ \t]+[a-z]/i.test(snapshot.source.slice(lineStart, lineEnd))) return true;
  for (let at = snapshot.source.lastIndexOf('\\', from); at >= 0; at = snapshot.source.lastIndexOf('\\', at - 1)) {
    const command = readInlineCommand(snapshot.source.slice(at));
    if (command && !command.error && command.groups[0] && from > at && to < at + command.groups[0].from) return true;
    if (at === 0) break;
  }
  return false;
}

export function applySourceSemanticMarks(view: EditorView, changes: { type: MarkType; attrs?: Record<string, unknown> | null }[], range?: { from: number; to: number }, allowCode = false) {
  const snapshot = sourceFormatSnapshot(view, true)!;
  const selected = sourceFormatRange(view, snapshot, range, allowCode); if (!selected) return false;
  let { from, to } = selected;
  if (from === to) {
    // A caret may change/remove an existing run, but cannot invent empty marks.
    if (!selected.leaves[0].node.marks.some(mark => changes.some(change => change.type === mark.type))) return false;
    from = selected.leaves[0].from; to = selected.leaves[0].to;
  }
  const tr = DocumentState.create({ doc: snapshot.doc }).tr;
  for (const leaf of selected.leaves) for (const change of changes) {
    const start = Math.max(from, leaf.from), end = Math.min(to, leaf.to);
    tr.removeMark(start, end, change.type);
    if (change.attrs !== null) tr.addMark(start, end, change.type.create(change.attrs));
  }
  if (!tr.docChanged || tr.doc.eq(snapshot.doc)) return false;
  inheritAuthoringSource(snapshot.doc, tr.doc);
  const written = serializeAuthoring(tr.doc);
  // A formatting action must not introduce block syntax from formerly wrapped prose.
  const check = documentParser().schema.nodeFromJSON(parseAuthoring(written.text).document);
  if (!check.eq(tr.doc)) return false;
  let start = 0, beforeEnd = snapshot.source.length, afterEnd = written.text.length;
  while (start < beforeEnd && start < afterEnd && snapshot.source[start] === written.text[start]) start++;
  while (beforeEnd > start && afterEnd > start && snapshot.source[beforeEnd - 1] === written.text[afterEnd - 1]) { beforeEnd--; afterEnd--; }
  const forward = view.state.selection.main.anchor <= view.state.selection.main.head;
  const selection = visualToAuthoring(tr.doc, written.spans, { anchor: forward ? from : to, head: forward ? to : from });
  view.dispatch({ changes: { from: start, to: beforeEnd, insert: written.text.slice(start, afterEnd) }, selection, userEvent: 'input.format', scrollIntoView: true });
  snapshots.delete(view);
  sourceFormatSnapshot(view, true);
  return true;
}
