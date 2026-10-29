import type { EditorView } from '@codemirror/view';
import type { TextStylePair } from './stylePreference';
import { sourceFormatSnapshot, sourceFormatRange, applySourceSemanticMarks } from '../editor-md/sourceSemanticFormatting';
import { parseColor } from '../declarative/registry';

/** Parse only on an explicit format action/palette opening. Rendering the
 * toolbar during typing may use an existing snapshot, but never parses text. */
export function sourceTextStyle(view: EditorView, parse = false): TextStylePair | null {
  const snapshot = sourceFormatSnapshot(view, parse); if (!snapshot) return null;
  const range = sourceFormatRange(view, snapshot); if (!range) return null;
  const styles = range.leaves.map(leaf => ({ color: leaf.node.marks.find(mark => mark.type.name === 'textColor')?.attrs.color ?? null,
    background: leaf.node.marks.find(mark => mark.type.name === 'highlight')?.attrs.color ?? null }));
  return { color: styles.every(style => style.color === styles[0].color) ? styles[0].color : null,
    background: styles.every(style => style.background === styles[0].background) ? styles[0].background : null };
}

/** Both file formats author the shared inline DSL; no private style footer is added. */
export function applySourceTextStyle(view: EditorView, change: Partial<TextStylePair>, toggleHighlight = false): boolean {
  const snapshot = sourceFormatSnapshot(view, true)!;
  const current = sourceTextStyle(view), changes = [];
  for (const [field, mark] of [['color', 'textColor'], ['background', 'highlight']] as const) {
    if (change[field] === undefined) continue;
    const value = change[field] === null ? null : parseColor(change[field]!);
    if (change[field] !== null && !value) return false;
    const remove = value === null || (field === 'background' && toggleHighlight && current?.background === value);
    changes.push({ type: snapshot.doc.type.schema.marks[mark], attrs: remove ? null : { color: value } });
  }
  return changes.length ? applySourceSemanticMarks(view, changes) : false;
}
