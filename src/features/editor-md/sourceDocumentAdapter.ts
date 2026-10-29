import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { NativeMetadata } from '../../core/nativeDocument';
import { readStyledSource } from '../document-style/sourceStyleTracking';

/** Source text and persisted text may have different representations. Keep the
 * conversion at the view boundary so save/history/export share one authority. */
export interface SourceDocumentAdapter {
  materialize(text: Text): string;
  replace(content: string): void;
  setMetadata?(metadata: NativeMetadata): void;
}
const adapters = new WeakMap<EditorView, SourceDocumentAdapter>();
export function setSourceDocumentAdapter(view: EditorView, adapter: SourceDocumentAdapter | null) {
  if (adapter) adapters.set(view, adapter); else adapters.delete(view);
}
export function sourceDocumentAdapter(view: EditorView) { return adapters.get(view); }
export function readSourceDocument(view: EditorView): string {
  return adapters.get(view)?.materialize(view.state.doc) ?? readStyledSource(view.state);
}
