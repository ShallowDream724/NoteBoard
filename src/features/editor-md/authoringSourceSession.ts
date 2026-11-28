import type { Node as DocumentNode, Schema } from '@tiptap/pm/model';
import { Transaction, type Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { readNativeMetadata, replaceNativeMetadata, type NativeMetadata } from '../../core/nativeDocument';
import { parseAuthoring, serializeAuthoring, rememberAuthoringSource, inheritAuthoringSource, type AuthoringSpan } from '../declarative/authoring';
import { parseNativeNode, serializeNativeNode } from './editorDocumentCodec';
import type { SourceDocumentAdapter } from './sourceDocumentAdapter';
import { sourceReplacement } from './sourceDocumentSync';
import { captureAuthoringSelection, authoringBookmarkSelection } from './authoringSourcePosition';

/** One live source session owns one immutable Text conversion cache. The persisted
 * frame snapshot remains byte-identical until an actual source edit occurs. */
export class AuthoringSourceSession implements SourceDocumentAdapter {
  private cachedText: Text | null = null;
  private storage: string;
  private metadata: NativeMetadata;
  private source: string;
  private parsedDocument: DocumentNode | null = null;
  private provenanceDocument: WeakRef<DocumentNode>;
  spans: AuthoringSpan[];
  constructor(private view: EditorView, private schema: Schema, private directory: string, storage: string, serialized?: ReturnType<typeof serializeAuthoring>, authoredDocument?: DocumentNode) {
    this.storage = storage;
    this.metadata = readNativeMetadata(storage);
    const doc = authoredDocument ?? parseNativeNode(storage, schema);
    serialized ??= serializeAuthoring(doc);
    this.provenanceDocument = new WeakRef(doc);
    this.source = serialized.text; this.spans = serialized.spans;
  }
  get text() { return this.source; }
  bind() { this.cachedText = this.view.state.doc; }
  materialize = (text: Text): string => {
    if (this.cachedText === text) return this.storage;
    const source = text.toString(), parsed = parseAuthoring(source);
    const doc = this.schema.nodeFromJSON(parsed.document); doc.check();
    rememberAuthoringSource(doc, parsed);
    this.parsedDocument = doc;
    this.provenanceDocument = new WeakRef(doc);
    const storage = serializeNativeNode(doc, this.directory, this.metadata);
    this.cachedText = text; this.storage = storage; this.source = source; this.spans = parsed.spans;
    return storage;
  };
  replace(storage: string) {
    const bookmark = captureAuthoringSelection(this.spans, this.view.state.selection.main);
    let serialized = { text: this.source, spans: this.spans };
    if (storage !== this.storage) {
      let previous = this.parsedDocument ?? this.provenanceDocument.deref();
      if (!previous) {
        const parsed = parseAuthoring(this.source);
        previous = this.schema.nodeFromJSON(parsed.document); rememberAuthoringSource(previous, parsed);
      }
      const doc = parseNativeNode(storage, this.schema);
      inheritAuthoringSource(previous, doc);
      serialized = serializeAuthoring(doc); this.provenanceDocument = new WeakRef(doc);
    }
    this.metadata = readNativeMetadata(storage);
    this.source = serialized.text; this.spans = serialized.spans; this.storage = storage;
    this.parsedDocument = null;
    const selection = authoringBookmarkSelection(this.spans, bookmark);
    if (this.view.state.doc.toString() !== this.source) this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: this.source },
      selection: { anchor: Math.min(this.source.length, selection.anchor), head: Math.min(this.source.length, selection.head) },
      annotations: [Transaction.addToHistory.of(false), sourceReplacement.of(true)],
    });
    this.bind();
  }
  setMetadata(metadata: NativeMetadata) {
    this.storage = replaceNativeMetadata(this.materialize(this.view.state.doc), metadata);
    this.metadata = metadata;
  }
  transferAuthoredSource(doc: DocumentNode) {
    if (this.parsedDocument) inheritAuthoringSource(this.parsedDocument, doc);
    this.provenanceDocument = new WeakRef(doc);
    this.parsedDocument = null;
  }
}

export * from './authoringSourcePosition';
