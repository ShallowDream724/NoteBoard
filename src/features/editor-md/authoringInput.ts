import { Extension, type JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, Selection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { parseAuthoring, serializeAuthoring } from '../declarative/authoring';
import { commandSpec, parseParameters } from '../declarative/registry';
import { readBlockCommand, readInlineCommand } from '../declarative/syntax';
import { dispatchDiscreteEdit } from './discreteEdit';
import { collectAnnotations, remapAnnotationIds } from './annotations/model';
import { openAnnotation } from './annotations/commands';
import { formattingMask } from './inlineFormattingMask';

const INPUT_WINDOW = 4096;
/** Application history otherwise derives a caret from the first changed range. */
export const AUTHORING_BEFORE_SELECTION_META = 'noteboard-before-selection';

function preserveInputCaret(tr: import('@tiptap/pm/state').Transaction, state: EditorState) {
  return tr.setMeta(AUTHORING_BEFORE_SELECTION_META, { anchor: state.selection.anchor, head: state.selection.head });
}

/** The shared parser owns syntax and validation. This adapter only recognizes
 * the user's current input range and chooses where its parsed nodes belong. */
export function authoringBlockTemplate(header: string): JSONContent | null {
  const match = /^::: +([a-z]+)(?:\s|$)/i.exec(header);
  const spec = match && commandSpec(match[1], true);
  // These declarations require document context or an explicit source payload.
  if (!spec || ['explain', 'native'].includes(spec.name)) return null;
  const result = parseAuthoring(`${header}\n\n:::`);
  if (result.diagnostics.some(item => item.severity === 'error')) return null;
  if (!result.document.content?.length || result.document.content.some(node => node.type === 'authoringRaw')) return null;
  return result.document;
}

function protectedScope(state: EditorState, from: number, to: number): boolean {
  const $from = state.doc.resolve(from), $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return true;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec.code || /^(?:math|authoringRaw)/i.test($from.node(depth).type.name)) return true;
  }
  if ((state.storedMarks ?? $from.marks()).some(mark => mark.type.spec.code || ['link', 'annotationReference'].includes(mark.type.name))) return true;
  let protectedText = false;
  state.doc.nodesBetween(from, to, node => {
    if ((node.isInline && !node.isText) || node.type.spec.code || node.marks.some(mark => mark.type.spec.code || ['link', 'annotationReference'].includes(mark.type.name))) protectedText = true;
  });
  return protectedText;
}

function referenceContext(state: EditorState, reference: string): string | null {
  const record = collectAnnotations(state.doc).get(reference);
  if (!record) return null;
  const body = state.schema.nodes.doc.create(null, record.node.content);
  return `\n\n::: annotation ${reference}\n${serializeAuthoring(body).text}\n:::`;
}

function inlineReplacement(state: EditorState, from: number, to: number, text: string): { from: number; content: Fragment; stores: PMNode[] } | null {
  if (!text.endsWith('}') || text.length > INPUT_WINDOW || protectedScope(state, from, to)) return null;
  const $from = state.doc.resolve(from);
  const offset = Math.max(0, $from.parentOffset - INPUT_WINDOW + text.length);
  const prefix = $from.parent.textBetween(offset, $from.parentOffset, '', '\ufffc') + text;
  const $to = state.doc.resolve(to);
  const after = $to.parent.textBetween($to.parentOffset, Math.min($to.parent.content.size, $to.parentOffset + INPUT_WINDOW), '', '\ufffc');
  const opaque = formattingMask(prefix + after, true);
  // Try outer declarations first: an unfinished outer command must not lose its
  // syntax when an inner command closes. Parsing remains bounded to this block.
  const starts = [...prefix.matchAll(/\\([a-z]+)(?=\[|\{)/gi)].filter(match => commandSpec(match[1]));
  for (const match of starts) {
    const index = match.index!;
    if (offset && index === 0) continue;
    if (opaque[index] !== prefix[index]) continue;
    if (index > 0 && /[\w/:\\]/.test(prefix[index - 1])) continue;
    const tokenPrefix = prefix.slice(0, index).split(/\s/).at(-1) ?? '';
    if (/(?:https?:|www\.)/i.test(tokenPrefix)) continue;
    const source = prefix.slice(index), command = readInlineCommand(source);
    if (command?.error) return null;
    if (!command || command.raw.length !== source.length) continue;
    const parameters = command.name === 'note' ? parseParameters('note', command.parameters, false) : null;
    const reference = parameters?.values.ref;
    let parserSource = source;
    if (typeof reference === 'string') {
      const context = referenceContext(state, reference);
      if (!context) return null;
      parserSource += context;
    }
    const parsed = parseAuthoring(parserSource);
    // Invalid and incomplete input stays literal, including nested declarations.
    if (parsed.diagnostics.some(item => item.severity === 'error')) return null;
    const blocks = (reference ? parsed.document : remapAnnotationIds(parsed.document)).content;
    const paragraphs = blocks?.filter(node => node.type !== 'annotationStore');
    if (paragraphs?.length !== 1 || paragraphs[0].type !== 'paragraph') return null;
    const inline = paragraphs[0].content ?? [];
    if (!inline.some(node => node.type !== 'text' || node.marks?.length)) return null;
    const start = $from.start() + offset + index;
    if (protectedScope(state, start, to)) return null;
    try { return { from: start, content: Fragment.fromArray(inline.map(node => state.schema.nodeFromJSON(node))),
      stores: reference ? [] : (blocks ?? []).filter(node => node.type === 'annotationStore').map(node => state.schema.nodeFromJSON(node)) }; }
    catch { return null; }
  }
  return null;
}

function mergeStores(tr: import('@tiptap/pm/state').Transaction, stores: PMNode[]): void {
  if (!stores.length) return;
  const bodies = stores.flatMap(store => { const nodes: PMNode[] = []; store.forEach(node => nodes.push(node)); return nodes; });
  let storeEnd: number | undefined;
  tr.doc.forEach((node, pos) => { if (node.type.name === 'annotationStore') storeEnd = pos + node.nodeSize - 1; });
  if (storeEnd !== undefined) tr.insert(storeEnd, bodies);
  else tr.insert(tr.doc.firstChild?.type.name === 'documentPresentation' ? tr.doc.firstChild.nodeSize : 0,
    tr.doc.type.schema.nodes.annotationStore.createChecked(null, bodies));
}

function enterFirstTextblock(tr: import('@tiptap/pm/state').Transaction, from: number, end: number): void {
  let caret: number | undefined;
  tr.doc.nodesBetween(from, Math.min(end, tr.doc.content.size), (node, pos) => {
    if (caret === undefined && node.isTextblock) caret = pos + 1;
    return caret === undefined;
  });
  tr.setSelection(caret === undefined ? Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size))) : TextSelection.create(tr.doc, caret));
}

export function convertAuthoringBlock(view: EditorView, onExplain?: (id: string) => void): boolean {
  const { state } = view, { $from, $to, empty } = state.selection;
  if (view.composing || !empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size
    || protectedScope(state, $from.start(), $to.end())) return false;
  const marker = $from.parent.textContent;
  // A block explanation owns the immediately preceding sibling. Parse just that
  // sibling and the new declaration so the same validation resolves its target.
  if (/^::: +explain(?:\s|$)/.test(marker)) {
    const parent = $from.node(-1), index = $from.index(-1), previous = index > 0 ? parent.child(index - 1) : null;
    if (!previous || previous.type.name === 'annotationStore' || previous.attrs.annotationId) return false;
    const command = readBlockCommand(`${marker}\n\n:::`);
    const reference = command && parseParameters('explain', command.parameters, true).values.ref;
    const context = typeof reference === 'string' ? referenceContext(state, reference) : '';
    if (context === null) return false;
    const parsed = parseAuthoring(`${serializeAuthoring(previous).text}\n\n${marker}\n\n:::${context}`);
    if (parsed.diagnostics.some(item => item.severity === 'error')) return false;
    const blocks = (reference ? parsed.document : remapAnnotationIds(parsed.document)).content ?? [];
    const ordinary = blocks.filter(node => node.type !== 'annotationStore');
    if (ordinary.length !== 1 || ordinary[0].type !== previous.type.name || !ordinary[0].attrs?.annotationId) return false;
    try {
      const start = $from.before() - previous.nodeSize;
      const tr = state.tr.replaceWith(start, $from.after(), state.schema.nodeFromJSON(ordinary[0]));
      if (!reference) mergeStores(tr, blocks.filter(node => node.type === 'annotationStore').map(node => state.schema.nodeFromJSON(node)));
      tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(start))));
      dispatchDiscreteEdit(view, preserveInputCaret(tr, state).scrollIntoView());
      onExplain?.(String(ordinary[0].attrs!.annotationId));
      return true;
    } catch { return false; }
  }
  const template = authoringBlockTemplate(marker);
  if (!template) return false;
  let nodes: PMNode[], stores: PMNode[];
  try {
    stores = template.content!.filter(node => node.type === 'annotationStore').map(node => state.schema.nodeFromJSON(node));
    if (stores.some(store => { let exists = false; store.forEach(body => { exists ||= collectAnnotations(state.doc).has(String(body.attrs.id)); }); return exists; })) return false;
    nodes = template.content!.filter(node => node.type !== 'annotationStore').map(node => state.schema.nodeFromJSON(node));
    if (!nodes.length) nodes = [state.schema.nodes.paragraph.create()];
  } catch { return false; }
  const start = $from.before(), fragment = Fragment.fromArray(nodes);
  const tr = state.tr.replaceWith(start, $from.after(), fragment).setStoredMarks(null);
  enterFirstTextblock(tr, start, start + fragment.size);
  mergeStores(tr, stores);
  dispatchDiscreteEdit(view, preserveInputCaret(tr, state).scrollIntoView());
  if (stores.length) onExplain?.(String(stores[0].firstChild!.attrs.id));
  return true;
}

export const AuthoringInput = Extension.create({
  name: 'authoringInput',
  priority: 1200,
  addKeyboardShortcuts() { return { Enter: () => convertAuthoringBlock(this.editor.view, id => openAnnotation(this.editor, id, { edit: true })) }; },
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        if (view.composing) return false;
        const replacement = inlineReplacement(view.state, from, to, text);
        if (!replacement) return false;
        // Keep the literal closing keystroke in its own snapshot first. A single
        // undo then restores the complete typed declaration and its caret.
        view.dispatch(view.state.tr.insertText(text, from, to));
        const end = from + text.length;
        const tr = view.state.tr.replace(replacement.from, end, new Slice(replacement.content, 0, 0)).setStoredMarks([]);
        tr.setSelection(TextSelection.create(tr.doc, replacement.from + replacement.content.size));
        mergeStores(tr, replacement.stores);
        dispatchDiscreteEdit(view, preserveInputCaret(tr, view.state).scrollIntoView());
        return true;
      },
    } })];
  },
});
