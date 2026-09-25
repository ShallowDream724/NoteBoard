import type { EditorView } from '@codemirror/view';
import { documentParser } from '../editor-md/documentExtensions';
import { mapDocumentSelection } from '../editor-md/sourcePosition';
import type { TextStylePair } from './stylePreference';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { readStyledSource } from './sourceStyleTracking';

const snapshots = new WeakMap<EditorView, { source: EditorView['state']['doc']; doc: DocumentNode }>();
function sourceDocument(view: EditorView, parse: boolean) {
  const cached = snapshots.get(view);
  if (cached?.source === view.state.doc) return cached.doc;
  if (!parse) return null;
  const { manager, schema } = documentParser();
  const doc = schema.nodeFromJSON(manager.parse(readStyledSource(view.state)));
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
  else doc.nodesBetween(from, to, node => {
    if (node.isText || node.type.name === 'mathInline') add(node.marks);
    if (node.type.name === 'mathBlock') styles.push({ color: node.attrs.textColor, background: node.attrs.background });
  });
  return { color: styles.length && styles.every(style => style.color === styles[0].color) ? styles[0].color : null,
    background: styles.length && styles.every(style => style.background === styles[0].background) ? styles[0].background : null };
}

/** Source editing preserves authored Markdown/HTML but never authors private
 * presentation metadata. Rich styles are applied after conversion in visual NB. */
export function applySourceTextStyle(_view: EditorView, _change: Partial<TextStylePair>, _toggleHighlight = false): boolean {
  return false;
}
