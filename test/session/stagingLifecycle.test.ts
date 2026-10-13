import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { discardStagedDocuments, drainStagingWrites, getStagedPath, stashPendingDocuments } from '@/features/staging/stagingManager';
import { disposeDocumentSession } from '@/features/session/documentSession';
import { useDocumentStore } from '@/stores/documentStore';
import { useWindowStore } from '@/stores/windowStore';
import * as ipc from '@/core/ipc/commands';
import type { StagingDocument, StagingResult } from '@/core/ipc/types';
import { syncDocumentContent } from '@/features/editor-code/orchestration/syncDocumentContent';

vi.mock('@/core/ipc/commands', () => ({ stashDocuments: vi.fn(), deleteStagedFile: vi.fn() }));
vi.mock('@/features/editor-code/orchestration/syncDocumentContent', () => ({ syncDocumentContent: vi.fn(async () => {}) }));

const key = 'C:\\staging-lifecycle\\note.md';
const files = new Map<string, string>();
let sequence = 0;
function persist(documents: StagingDocument[]): StagingResult[] {
  return documents.map(document => {
    const targetPath = document.targetPath ?? `C:\\recovery\\copy-${++sequence}.md`;
    files.set(targetPath, document.content);
    return { key: document.key, targetPath };
  });
}
function open(content = 'unsaved') {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'note.md', dirPath: 'C:\\staging-lifecycle',
    kind: 'markdown', language: 'markdown', content: 'original', encoding: 'utf8', eol: 'lf', size: 8, mtime: 0, readonly: false });
  useDocumentStore.getState().setContent(key, content);
  useWindowStore.getState().openTab({ key, displayName: 'note.md', path: key, kind: 'markdown', language: 'markdown',
    isDirty: true, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
}
function close() {
  disposeDocumentSession(key);
  useDocumentStore.getState().remove(key);
  useWindowStore.setState({ tabs: [], activeKey: null });
}
beforeEach(() => {
  files.clear(); sequence = 0;
  vi.mocked(ipc.stashDocuments).mockReset().mockImplementation(async documents => persist(documents));
  vi.mocked(ipc.deleteStagedFile).mockReset().mockImplementation(async path => { files.delete(path); });
});
afterEach(async () => { await drainStagingWrites(); close(); });

it('detaches a retained copy on final close; reopening and discarding cannot overwrite or delete it', async () => {
  open('retained first edit');
  await stashPendingDocuments({ keys: [key], retain: true });
  const retained = getStagedPath(key)!;
  close();
  expect(getStagedPath(key)).toBeNull();
  expect(files.get(retained)).toBe('retained first edit');

  open('second session edit');
  await stashPendingDocuments({ keys: [key] });
  const current = getStagedPath(key)!;
  expect(current).not.toBe(retained);
  expect(vi.mocked(ipc.stashDocuments).mock.calls[1][0][0].targetPath).toBeNull();
  await discardStagedDocuments([key]);
  expect(files.has(current)).toBe(false);
  expect(files.get(retained)).toBe('retained first edit');
});

it('does not reattach a completed old write or run a queued explicit request against a reopened session', async () => {
  open('old session');
  let release!: () => void, started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(ipc.stashDocuments).mockImplementationOnce(documents => new Promise(resolve => {
    release = () => resolve(persist(documents)); started();
  }));
  const oldWrite = stashPendingDocuments({ keys: [key], retain: true });
  await writing;
  const queuedOldWrite = stashPendingDocuments({ keys: [key], retain: true });
  const rejectedOldWrite = expect(oldWrite).rejects.toThrow('文档会话已改变');
  const rejectedQueuedWrite = expect(queuedOldWrite).rejects.toThrow('文档会话已改变');
  close(); open('new session');
  release(); await rejectedOldWrite; await rejectedQueuedWrite;
  expect(getStagedPath(key)).toBeNull();
  expect(ipc.stashDocuments).toHaveBeenCalledTimes(1);
  await stashPendingDocuments({ keys: [key] });
  expect(vi.mocked(ipc.stashDocuments).mock.calls[1][0][0]).toMatchObject({ content: 'new session', targetPath: null });
  expect([...files.values()]).toEqual(['old session', 'new session']);
});

it('repeated retained sessions release in-memory staging ownership without deleting their copies', async () => {
  for (let index = 0; index < 30; index++) {
    open(`retained-${index}`);
    await stashPendingDocuments({ keys: [key], retain: true });
    close(); close();
    expect(getStagedPath(key)).toBeNull();
  }
  expect(files.size).toBe(30);
  expect(ipc.deleteStagedFile).not.toHaveBeenCalled();
});

it('rejects retain-and-close when a session ends during capture before any snapshot is produced', async () => {
  open();
  let release!: () => void, started!: () => void;
  const capturing = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(syncDocumentContent).mockImplementationOnce(() => new Promise<undefined>(resolve => { release = () => resolve(undefined); started(); }));
  const request = stashPendingDocuments({ keys: [key], retain: true });
  const rejected = expect(request).rejects.toThrow('文档会话已改变');
  await capturing; close(); open('new session'); release();
  await rejected;
  expect(ipc.stashDocuments).not.toHaveBeenCalled();
  expect(getStagedPath(key)).toBeNull();
});
