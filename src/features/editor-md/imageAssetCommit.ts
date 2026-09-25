import { Transaction } from '@codemirror/state';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { synchronizeCurrentDocumentHistoryContent } from '../history/documentHistory';
import { getMdSourceView, getMdTipTapEditor } from './editorInstances';
import { rememberEditorDocumentSource, serializeEditorDocument } from './editorDocumentCodec';
import { sourceReplacement } from './sourceDocumentSync';
import type { PreparedImageSources } from './imageAssetSource';
import { ImageSourcesStep } from './imageSourcesStep';
import { flushPendingSourceSnapshot, flushPendingVisualSnapshot } from './visualSnapshot';

/** Caller flushes pending input first. A changed snapshot stays dirty and retains
 * its still-valid recovery paths; a later save can materialize it without loss. */
export function commitImageAssetSources(key: string, captured: string, prepared: PreparedImageSources): void {
  if (!prepared.references.length) return;
  const mode = useWindowStore.getState().getTab(key)?.viewMode === 'source' ? 'source' : 'visual';
  const references = new Map(prepared.references), editor = mode === 'visual' ? getMdTipTapEditor(key) : undefined;
  const source = getMdSourceView(key);
  // No await after this final authority check. A pending input mirror can lag
  // behind either live view while callers await a linked-file flush or import.
  if (mode === 'source') {
    flushPendingSourceSnapshot(key);
    if (source && source.state.doc.toString() !== captured) return;
  } else {
    flushPendingVisualSnapshot(key);
    if (editor && serializeEditorDocument(editor) !== captured) return;
  }
  if (useDocumentStore.getState().getDocument(key)?.content !== captured) return;
  if (editor) {
    const patches: Array<{ pos: number; src: string }> = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== 'image') return;
      const src = references.get(node.attrs.src);
      if (src) patches.push({ pos: position, src });
    });
    if (patches.length) editor.view.dispatch(editor.state.tr.step(new ImageSourcesStep(patches)).setMeta('addToHistory', false).setMeta('noteboard-document-replacement', 'sync'));
    rememberEditorDocumentSource(editor, prepared.content);
  }
  if (source && source.state.doc.toString() === captured) source.dispatch({ changes: prepared.changes, annotations: [Transaction.addToHistory.of(false), sourceReplacement.of(true)] });
  useDocumentStore.getState().setContent(key, prepared.content);
  synchronizeCurrentDocumentHistoryContent(key, prepared.content, mode);
}
