import type { Node as DocumentNode, Schema } from '@tiptap/pm/model';
import { Transaction, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { readNativeMetadata, replaceNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';
import { serializeAuthoring, rememberAuthoringSource, type AuthoringSpan } from '../declarative/authoring';
import { parseNativeNode, serializeNativeNode } from './editorDocumentCodec';
import type { SourceDocumentAdapter } from './sourceDocumentAdapter';
import { sourceReplacement } from './sourceDocumentSync';
import { captureAuthoringSelection, authoringBookmarkSelection } from './authoringSourcePosition';
import { parseNativeAuthoring } from './nativeAuthoringSource';

/** One live source session owns one immutable Text conversion cache. The persisted
 * frame snapshot remains byte-identical until an actual source edit occurs. */
export class AuthoringSourceSession implements SourceDocumentAdapter {
  private cachedText: Text | null = null;
  private storage: string;
  private metadata: NativeMetadata;
  private source: string;
  spans: AuthoringSpan[];
  constructor(private view: EditorView, private schema: Schema, private directory: string, storage: string, serialized?: ReturnType<typeof serializeAuthoring>, authoredDocument?: DocumentNode) {
    this.storage = storage;
    this.metadata = readNativeMetadata(storage);
    const doc = authoredDocument ?? parseNativeNode(storage, schema, directory);
    serialized ??= serializeAuthoring(doc);
    this.source = serialized.text; this.spans = serialized.spans;
  }
  get text() { return this.source; }
  bind() { this.cachedText = this.view.state.doc; }
  materialize = (text: Text): string => {
    if (this.cachedText === text) return this.storage;
    const source = text.toString();
    if (source === this.source) { this.cachedText = text; return this.storage; }
    const parsed = parseNativeAuthoring(source, this.directory);
    const doc = this.schema.nodeFromJSON(parsed.document); doc.check();
    rememberAuthoringSource(doc, parsed);
    const storage = serializeNativeNode(doc, this.directory, this.metadata);
    this.metadata = readNativeMetadata(storage);
    this.cachedText = text; this.storage = storage; this.source = source; this.spans = parsed.spans;
    return storage;
  };
  replace(storage: string) {
    const bookmark = captureAuthoringSelection(this.spans, this.view.state.selection.main);
    let serialized = { text: this.source, spans: this.spans };
    const metadata = readNativeMetadata(storage);
    if (storage !== this.storage) serialized = serializeAuthoring(parseNativeNode(storage, this.schema, this.directory));
    this.metadata = metadata;
    this.source = serialized.text; this.spans = serialized.spans; this.storage = storage;
    const selection = authoringBookmarkSelection(this.spans, bookmark);
    if (this.view.state.doc.toString() !== this.source) this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.source },
      selection: { anchor: Math.min(this.source.length, selection.anchor), head: Math.min(this.source.length, selection.head) },
      annotations: [Transaction.addToHistory.of(false), sourceReplacement.of(true)],
    });
    this.bind();
  }
  setMetadata(metadata: NativeMetadata) {
    const storage = this.materialize(this.view.state.doc);
    this.metadata = this.metadata.authoring ? { ...metadata, authoring: this.metadata.authoring } : metadata;
    this.storage = replaceNativeMetadata(storage, this.metadata);
  }
}

export * from './authoringSourcePosition';
