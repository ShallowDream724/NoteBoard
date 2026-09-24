import { StateEffect, StateField, type EditorState, type Text } from '@codemirror/state';
import { documentParser } from '../editor-md/documentExtensions';
import { presentationBody } from './presentationMetadata';
import { applyStyleRanges, documentStyleRanges, mapStyleRanges, type SpanStyle, type StyleLayer } from './sourceStyleRanges';
import { buildStyleSpans, replaceStyleSpans, styleSpans, type SpanTree } from './styleSpanTree';

const layers: StyleLayer[] = ['text', 'block', 'cell'];
export interface SourceStyles {
  bodyEnd: number;
  trees: Partial<Record<StyleLayer, SpanTree<SpanStyle> | null>>;
  dirty: boolean;
}
export const resetSourceStyles = StateEffect.define<null>();
function initialize(text: Text): SourceStyles {
  const source = text.toString();
  if (!source.includes('<!-- noteboard-styles ') && !source.includes('<mark') && !source.includes('data-text-color')) {
    return { bodyEnd: text.length, trees: {}, dirty: false };
  }
  const { manager, schema } = documentParser(), body = presentationBody(source, manager.instance);
  const doc = schema.nodeFromJSON(manager.parse(source));
  const ranges = mapStyleRanges(doc, manager, body, 'source', documentStyleRanges(doc));
  const trees: SourceStyles['trees'] = {};
  for (const kind of layers) {
    const matching = ranges.filter(range => range.value.kind === kind);
    if (matching.length) trees[kind] = buildStyleSpans(body.length, matching);
  }
  return { bodyEnd: body.length, trees, dirty: false };
}
export const sourceStylesField = StateField.define<SourceStyles>({
  create: state => initialize(state.doc),
  update(previous, transaction) {
    if (transaction.effects.some(effect => effect.is(resetSourceStyles))) return initialize(transaction.newDoc);
    if (!transaction.docChanged) return previous;
    // Direct edits to the annotation itself are authoritative. Do not silently
    // replace a hand-edited footer with an older in-memory interpretation.
    let annotationEdited = false;
    transaction.changes.iterChangedRanges((from, to) => { if (from > previous.bodyEnd || to > previous.bodyEnd) annotationEdited = true; });
    if (annotationEdited) return { bodyEnd: transaction.newDoc.length, trees: {}, dirty: false };
    if (!Object.keys(previous.trees).length) return { ...previous, bodyEnd: transaction.changes.mapPos(previous.bodyEnd, 1) };
    const trees = { ...previous.trees }; let delta = 0;
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      for (const kind of layers) if (trees[kind]) trees[kind] = replaceStyleSpans(trees[kind]!, from + delta, to + delta, inserted.length);
      delta += inserted.length - (to - from);
    });
    return { bodyEnd: previous.bodyEnd + delta, trees, dirty: true };
  },
});

const materialized = new WeakMap<Text, { styles: SourceStyles | undefined; content: string }>();
/** This is the existing save/history/mode-transfer materialization boundary.
 * Keystrokes retain immutable rope roots; whole-document work occurs here. */
export function materializeSourceStyles(text: Text, styles?: SourceStyles): string {
  const cached = materialized.get(text);
  if (cached && cached.styles === styles) return cached.content;
  const source = text.toString();
  if (!styles?.dirty) { materialized.set(text, { styles, content: source }); return source; }
  const body = source.slice(0, styles.bodyEnd), { manager, schema } = documentParser();
  const doc = schema.nodeFromJSON(manager.parse(source));
  const ranges = layers.flatMap(kind => [...styleSpans(styles.trees[kind] ?? null)]);
  const mapped = mapStyleRanges(doc, manager, body, 'visual', ranges);
  const formatted = manager.serialize(applyStyleRanges(doc, mapped));
  const footer = formatted.lastIndexOf('\n\n<!-- noteboard-styles ');
  const content = body + (footer >= 0 ? formatted.slice(footer) : '');
  materialized.set(text, { styles, content }); return content;
}
export function readSourceStyles(state: EditorState): SourceStyles | undefined {
  return state.field?.(sourceStylesField, false);
}
export function readStyledSource(state: EditorState): string {
  return materializeSourceStyles(state.doc, readSourceStyles(state));
}
