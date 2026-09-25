import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document } from '../../src/stores/documentStore';
import { encodeNativeDocument, readNativeMetadata, replaceNativeMetadata } from '../../src/core/nativeDocument';

const state = vi.hoisted(() => ({
  documents: new Map<string, Document>(), revisions: new Map<string, number>(), generation: 1, revision: 1, merged: '', diskHash: 'external-hash',
  read: vi.fn(), merge: vi.fn(), history: vi.fn(),
}));
vi.mock('../../src/core/ipc/commands', () => ({ readDocument: state.read }));
vi.mock('../../src/core/nativeDocumentIO', () => ({ documentTextHash: async () => state.diskHash }));
vi.mock('../../src/stores/documentStore', () => ({ useDocumentStore: { getState: () => ({
  documents: state.documents, getDocument: (key: string) => state.documents.get(key),
  setContent: (key: string, content: string) => { const doc = state.documents.get(key)!; state.documents.set(key, { ...doc, content, isDirty: content !== doc.baselineContent }); },
}) } }));
vi.mock('../../src/stores/windowStore', () => ({ useWindowStore: { getState: () => ({ getTab: () => ({ viewMode: 'visual' }), setTabDirty: vi.fn() }) } }));
vi.mock('../../src/features/session/documentSession', () => ({ getSessionGeneration: () => state.generation, flushDocument: async () => null }));
vi.mock('../../src/core/editor/editorRegistry', () => ({ getDocumentRevision: (key: string) => state.revisions.get(key) ?? state.revision, getEditorCapabilities: () => undefined, bumpDocumentRevision: (key: string) => state.revisions.set(key, (state.revisions.get(key) ?? state.revision) + 1) }));
vi.mock('../../src/features/export/documentConversion', () => ({ prepareTextExport: async () => 'converted snapshot' }));
vi.mock('../../src/features/document-format/linkedMarkdownUpdatesWorkerClient', () => ({ prepareLinkedMarkdownMerge: state.merge }));
vi.mock('../../src/features/editor-md/editorInstances', () => ({ getMdTipTapEditor: () => undefined, getMdSourceView: () => undefined }));
vi.mock('../../src/features/editor-md/editorDocumentCodec', () => ({ parseEditorDocument: vi.fn() }));
vi.mock('../../src/features/editor-md/sourceDocumentSync', () => ({ sourceReplacement: { of: vi.fn() } }));
vi.mock('../../src/features/history/documentHistory', () => ({ getCurrentDocumentHistoryContent: () => 'initial', recordDocumentChange: state.history, initializeDocumentHistory: vi.fn() }));

import { acceptLinkedMarkdownOverwrite, checkLinkedMarkdownUpdates, clearLinkedMarkdownSession, getAcceptedLinkedMarkdownHash, getLinkedMarkdownConflict, unlinkMarkdownAssociation } from '../../src/features/document-format/linkedMarkdownUpdates';

const key = 'C:\\notes\\note.nb', markdownPath = 'C:\\notes\\note.md';
function source(hash: string): string { return encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }] }, { markdown: { path: 'note.md', baselineHash: hash, projectionVersion: 1 } }); }

beforeEach(() => {
  state.documents.clear(); state.revisions.clear(); state.generation++; state.revision = 1; state.diskHash = 'external-hash';
  const initial = source('original-hash'); state.merged = source(state.diskHash);
  state.documents.set(key, { key, kind: 'noteboard', content: initial, baselineContent: initial, isDirty: false } as Document);
  state.read.mockReset().mockResolvedValue({ content: 'external update', encoding: 'utf8', eol: 'lf' });
  state.merge.mockReset().mockResolvedValue({ kind: 'merged', content: state.merged, patches: [], changedBlocks: 1 });
  state.history.mockReset();
});
afterEach(() => { for (const documentKey of state.documents.keys()) clearLinkedMarkdownSession(documentKey); clearLinkedMarkdownSession(key); });

describe('linked Markdown update lifecycle', () => {
  it('applies remote changes in memory without changing the NB disk baseline', async () => {
    const original = state.documents.get(key)!.baselineContent;
    await checkLinkedMarkdownUpdates(key);
    expect(state.documents.get(key)).toMatchObject({ content: state.merged, baselineContent: original, isDirty: true });
    expect(state.history).toHaveBeenCalledWith(key, state.merged, { mode: 'visual', startsNewGroup: true });
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, state.merged)).toBe('external-hash');
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, original!)).toBeUndefined();
  });

  it('makes an undone merge actionable even if the Markdown has not changed again', async () => {
    await checkLinkedMarkdownUpdates(key);
    const doc = state.documents.get(key)!;
    state.documents.set(key, { ...doc, content: doc.baselineContent, isDirty: false });
    await checkLinkedMarkdownUpdates(key);
    expect(getLinkedMarkdownConflict(key)).toMatchObject({ reason: 'overlap', markdownPath });
    expect(state.merge).toHaveBeenCalledTimes(1);
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, doc.baselineContent!)).toBeUndefined();
    expect(await acceptLinkedMarkdownOverwrite(key)).toBe(true);
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, doc.baselineContent!)).toBe('external-hash');
    expect(getLinkedMarkdownConflict(key)).toBeUndefined();
  });

  it('does not apply a worker result after the native session has changed', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.merge.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = checkLinkedMarkdownUpdates(key);
    await vi.waitFor(() => expect(finish).toBeDefined());
    state.generation++;
    const content = source('reopened-hash');
    state.documents.set(key, { ...state.documents.get(key)!, content, baselineContent: content });
    finish!({ kind: 'merged', content: state.merged, patches: [], changedBlocks: 1 });
    await task;
    expect(state.documents.get(key)!.content).toBe(content);
    expect(state.history).not.toHaveBeenCalled();
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, content)).toBeUndefined();
  });

  it('bounds active checks across documents and discards a closed queued session before reading it', async () => {
    const releases: (() => void)[] = [];
    state.read.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve({ content: 'external update' })); }));
    const keys = Array.from({ length: 5 }, (_, index) => `C:\\notes\\note-${index}.nb`);
    const initial = state.documents.get(key)!;
    for (const documentKey of keys) state.documents.set(documentKey, { ...initial, key: documentKey });
    const tasks = keys.map(checkLinkedMarkdownUpdates);
    await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
    clearLinkedMarkdownSession(keys[4]); state.documents.delete(keys[4]);
    releases[0](); releases[1]();
    await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(4));
    releases[2](); releases[3]();
    await Promise.all(tasks);
    expect(state.read).toHaveBeenCalledTimes(4);
    expect(keys.slice(0, 4).map(documentKey => ({ key: documentKey, conflict: getLinkedMarkdownConflict(documentKey), content: state.documents.get(documentKey)?.content }))).toEqual(keys.slice(0, 4).map(documentKey => ({ key: documentKey, conflict: undefined, content: state.merged })));
  });

  it('unlinks a missing Markdown file as an undoable edit while preserving the body, other metadata and disk baseline', async () => {
    const original = state.documents.get(key)!;
    const before = replaceNativeMetadata(original.content!, { ...readNativeMetadata(original.content!), workspace: { label: 'retained' } });
    state.documents.set(key, { ...original, content: before, baselineContent: before });
    state.read.mockRejectedValue(new Error('file missing'));
    await checkLinkedMarkdownUpdates(key);
    expect(getLinkedMarkdownConflict(key)?.reason).toBe('unreadable');
    expect(await unlinkMarkdownAssociation(key)).toBe(true);
    const current = state.documents.get(key)!;
    expect(readNativeMetadata(current.content!)).toEqual({ workspace: { label: 'retained' } });
    expect(current.content!.slice(current.content!.indexOf('@block '))).toBe(before.slice(before.indexOf('@block ')));
    expect(current).toMatchObject({ isDirty: true, baselineContent: before });
    expect(state.history).toHaveBeenCalledWith(key, current.content, { mode: 'visual', startsNewGroup: true });
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(getLinkedMarkdownConflict(key)).toBeUndefined();
    expect(getAcceptedLinkedMarkdownHash(key, markdownPath, before)).toBeUndefined();
  });
});
