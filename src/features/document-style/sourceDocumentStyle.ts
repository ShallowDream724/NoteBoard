import type { EditorView } from '@codemirror/view';
import { EditorState } from '@tiptap/pm/state';
import { documentParser } from '../editor-md/documentExtensions';
import { mapDocumentSelection } from '../editor-md/sourcePosition';
import { presentationBody } from './presentationMetadata';
import { documentColor } from './colors';
import type { TextStylePair } from './stylePreference';
import type { Node as DocumentNode } from '@tiptap/pm/model';

const snapshots = new WeakMap<EditorView, { source: EditorView['state']['doc']; doc: DocumentNode }>();
function sourceDocument(view: EditorView, parse: boolean) {
  const cached = snapshots.get(view);
  if (cached?.source === view.state.doc) return cached.doc;
  if (!parse) return null;
  const { manager, schema } = documentParser();
  const doc = schema.nodeFromJSON(manager.parse(view.state.doc.toString()));
  snapshots.set(view, { source: view.state.doc, doc });
  return doc;
}

/** Parse only on an explicit format action/palette opening. Rendering the
 * toolbar during typing may use an existing snapshot, but never parses text. */
export function sourceTextStyle(view: EditorView, parse = false): TextStylePair | null {
  const doc = sourceDocument(view, parse); if (!doc) return null;
  const { manager } = documentParser(), selection = view.state.selection.main;
  const mapped = mapDocumentSelection(doc, manager, view.state.doc.toString(), 'visual', selection, view);
  const from = Math.min(mapped.anchor, mapped.head), to = Math.max(mapped.anchor, mapped.head);
  const styles: TextStylePair[] = [];
  const add = (marks: DocumentNode['marks']) => styles.push({ color: marks.find(mark => mark.type.name === 'textColor')?.attrs.color ?? null,
    background: marks.find(mark => mark.type.name === 'highlight')?.attrs.color ?? null });
  if (from === to) add(doc.resolve(from).marks());
  else doc.nodesBetween(from, to, node => { if (node.isText) add(node.marks); });
  return { color: styles.length && styles.every(style => style.color === styles[0].color) ? styles[0].color : null,
    background: styles.length && styles.every(style => style.background === styles[0].background) ? styles[0].background : null };
}

/** Explicit source-format actions parse once, update only the annotation footer,
 * and preserve the author's Markdown spelling/spacing and selection offsets. */
export function applySourceTextStyle(view: EditorView, change: Partial<TextStylePair>, toggleHighlight = false) {
  const selection = view.state.selection.main; if (selection.empty) return false;
  const source = view.state.doc.toString(), { manager, schema } = documentParser();
  const body = presentationBody(source, manager.instance);
  if (selection.to > body.length) return false;
  const doc = sourceDocument(view, true)!;
  const mapped = mapDocumentSelection(doc, manager, source, 'visual', selection, view);
  const from = Math.min(mapped.anchor, mapped.head), to = Math.max(mapped.anchor, mapped.head);
  if (from === to) return false;
  const tr = EditorState.create({ doc }).tr;
  if (toggleHighlight && doc.rangeHasMark(from, to, schema.marks.highlight)) change = { ...change, background: null };
  for (const [key, mark] of [['color','textColor'],['background','highlight']] as const) {
    if (change[key] === undefined) continue;
    tr.removeMark(from, to, schema.marks[mark]);
    const color = documentColor(change[key]); if (color) tr.addMark(from, to, schema.marks[mark].create({ color }));
  }
  if (!tr.docChanged) return false;
  const serialized = manager.serialize(tr.doc.toJSON()), start = serialized.lastIndexOf('\n\n<!-- noteboard-styles ');
  const next = body + (start >= 0 ? serialized.slice(start) : '');
  // The body is byte-for-byte unchanged; replace only the old footer suffix.
  view.dispatch({ changes: { from: body.length, to: source.length, insert: next.slice(body.length) }, selection });
  snapshots.set(view, { source: view.state.doc, doc: tr.doc });
  return true;
}
