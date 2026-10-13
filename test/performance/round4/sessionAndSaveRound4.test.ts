// 真实关闭/会话/另存为编排，所有磁盘和窗口 IPC 使用内存替身。
import { beforeEach, expect, it, vi } from 'vitest';
import { Text } from '@codemirror/state';
import * as ipc from '@/core/ipc/commands';
import { save } from '@tauri-apps/plugin-dialog';
import { saveAs } from '@/features/editor-code/orchestration/saveDocument';
import { useSaveActivityStore } from '@/stores/saveActivityStore';
import { useWindowStore, disposeTabLifecycleAsync } from '@/stores/windowStore';
import { useDocumentStore } from '@/stores/documentStore';
import { __debugSessionState, writeDocumentWithBarrier } from '@/features/session/documentSession';
import { stagePendingSourceSnapshot, discardPendingSourceSnapshot } from '@/features/editor-md/visualSnapshot';
import { initializeDocumentHistory, getCurrentDocumentHistoryContent } from '@/features/history/documentHistory';
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'review' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@/features/staging/stagingManager', () => ({ onDocumentSaved: vi.fn().mockResolvedValue(undefined), getStagedPath: vi.fn(), drainStagingWrites: vi.fn().mockResolvedValue(undefined), migrateStagedDocumentKey: vi.fn(), releaseStagedDocument: vi.fn() }));
vi.mock('@/features/explorer/directoryWatcher', () => ({ noteSelfWrite: vi.fn() }));
vi.mock('@/core/ipc/commands', () => ({ unregisterDocument: vi.fn(), registerDocument: vi.fn(), writeDocument: vi.fn(), setDocumentDirty: vi.fn(), pathExists: vi.fn() }));

function seed(key: string): void {
  useDocumentStore.getState().upsertFromPayload({ key, displayName: 'review.md', dirPath: 'C:/round4', kind: 'markdown', language: 'markdown', content: 'base', encoding: 'utf8', eol: 'lf', size: 4, mtime: 0, readonly: false });
  useWindowStore.getState().openTab({ key, path: key, displayName: 'review.md', kind: 'markdown', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'source', externalStatus: null, isDetached: false });
}
async function microtasks(): Promise<void> { for (let i = 0; i < 100; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.resetAllMocks(); useWindowStore.setState({ tabs: [], activeKey: null }); useDocumentStore.setState({ documents: new Map() });
  vi.mocked(ipc.unregisterDocument).mockResolvedValue(undefined);
  vi.mocked(ipc.registerDocument).mockResolvedValue({ type:'ok' });
  vi.mocked(ipc.writeDocument).mockResolvedValue({ ok:true, size:4, mtime:1 } as never);
  vi.mocked(ipc.pathExists).mockResolvedValue({ exists: false, isDir: false });
});

it('另存为重复请求只打开一个对话框，取消后不伪造保存失败', async () => {
  const key = 'untitled:coalesced'; seed(key);
  let cancel!: (path: null) => void;
  vi.mocked(save).mockImplementation(() => new Promise(resolve => { cancel = resolve; }));
  const first = saveAs(key, 'base');
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  useDocumentStore.getState().setContent(key, '对话框期间的新输入');
  expect(saveAs(key, 'base')).toBe(first);
  cancel(null);
  expect(await first).toBe(false);
  expect(ipc.writeDocument).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().getDocument(key)?.isDirty).toBe(true);
  expect(useSaveActivityStore.getState().activities.has(key)).toBe(false);
});

function deleted(key: string) {
  seed(key); useDocumentStore.getState().setContent(key, '未保存的新内容');
  useDocumentStore.getState().setExternalStatus(key, 'deleted');
  useWindowStore.getState().setTabDetached(key, true);
  useWindowStore.getState().setTabExternalStatus(key, 'deleted');
  useWindowStore.getState().setTabDirty(key, true);
}

it('已删除文件另存为选择原路径只询问一次，并原子仅创建后解除断开', async () => {
  const key = 'C:/round4/recreate.md'; deleted(key); vi.mocked(save).mockResolvedValue(key);
  expect(await saveAs(key, '')).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(ipc.writeDocument).toHaveBeenCalledWith(key, '未保存的新内容', 'utf8', 'lf', true);
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: '未保存的新内容', baselineContent: '未保存的新内容', isDirty: false, externalStatus: 'clean' });
  expect(useWindowStore.getState().getTab(key)).toMatchObject({ isDetached: false, externalStatus: 'clean', isDirty: false });
});

it('已删除文件取消另存为不重建路径或改变断开和未保存状态', async () => {
  const key = 'C:/round4/cancel-recreate.md'; deleted(key); vi.mocked(save).mockResolvedValue(null);
  expect(await saveAs(key, '')).toBe(false);
  expect(ipc.writeDocument).not.toHaveBeenCalled(); expect(ipc.registerDocument).not.toHaveBeenCalled();
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: '未保存的新内容', isDirty: true, externalStatus: 'deleted' });
  expect(useWindowStore.getState().getTab(key)?.isDetached).toBe(true);
});

it('原路径出现其它文件时拒绝覆盖，创建竞争失败也保留未保存内容和断开状态', async () => {
  const key = 'C:/round4/foreign-recreate.md'; deleted(key); vi.mocked(save).mockResolvedValue(key);
  vi.mocked(ipc.pathExists).mockResolvedValueOnce({ exists: true, isDir: false });
  expect(await saveAs(key, '')).toBe(false); expect(ipc.writeDocument).not.toHaveBeenCalled();
  vi.mocked(ipc.writeDocument).mockResolvedValueOnce({ ok: false, size: 0, mtime: 0, error: { kind: 'io', message: '目标已存在，未覆盖' } });
  expect(await saveAs(key, '')).toBe(false);
  expect(ipc.writeDocument).toHaveBeenCalledWith(key, '未保存的新内容', 'utf8', 'lf', true);
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ content: '未保存的新内容', baselineContent: 'base', isDirty: true, externalStatus: 'deleted' });
  expect(useWindowStore.getState().getTab(key)?.isDetached).toBe(true);
});

it('D04：真实标签关闭后会话表与 closing 表应回落，而非永久保留每条路径', async () => {
  const keys = Array.from({ length: 30 }, (_, i) => `C:/round4/closed-${i}.md`);
  for (const key of keys) { seed(key); useWindowStore.getState().closeTab(key); }
  await microtasks();
  const state = __debugSessionState();
  expect({ active:keys.filter(key=>state.active.has(key)).length, closing:keys.filter(key=>state.closing.has(key)).length, queue:keys.filter(key=>state.queues.has(key)).length }).toEqual({ active:0, closing:0, queue:0 });
});

it('D05：同路径关闭重开后再次关闭，第二次关闭仍须阻止迟到写入', async () => {
  const key = 'C:/round4/second-close.md'; seed(key); useWindowStore.getState().closeTab(key); await microtasks();
  seed(key); await disposeTabLifecycleAsync(key);
  const result = await writeDocumentWithBarrier(key, 'late-old-write');
  expect({result,writes:vi.mocked(ipc.writeDocument).mock.calls.length}).toEqual({result:false,writes:0});
});

it('D06：另存为等待注销时产生的 Markdown pending 输入必须进入新会话', async () => {
  const key = 'C:/round4/pending-save.md', target='C:/round4/pending-target.md'; seed(key);
  vi.mocked(save).mockResolvedValue(target);
  let release!: () => void;
  vi.mocked(ipc.unregisterDocument).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  const work = saveAs(key, 'base');
  await vi.waitFor(() => expect(ipc.unregisterDocument).toHaveBeenCalledWith('review', key));
  // 与真实 source onUpdate 相同：新输入先暂存不可变 Text，500ms 前镜像仍为 base。
  stagePendingSourceSnapshot(key,{text:Text.of(['typed-during-unregister']),revision:1,isNewGroup:true});
  release(); await work;
  try { expect(useDocumentStore.getState().getDocument(target)?.content).toBe('typed-during-unregister'); }
  finally { discardPendingSourceSnapshot(key); }
});

// 不仅保留正文，还要把同一笔等待期间输入带入新身份的历史，避免首次撤销跳过该笔编辑。
it('另存为注销期间输入的历史末端也必须随新身份迁移', async () => {
  const key = 'C:/round4/history-save.md', target = 'C:/round4/history-target.md';
  seed(key);
  initializeDocumentHistory(key, 'base', 'source');
  vi.mocked(save).mockResolvedValue(target);
  let release!: () => void;
  vi.mocked(ipc.unregisterDocument).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const work = saveAs(key, 'base');
  await vi.waitFor(() => expect(ipc.unregisterDocument).toHaveBeenCalledWith('review', key));
  stagePendingSourceSnapshot(key, { text: Text.of(['late-history']), revision: 1, isNewGroup: true });
  release();
  await work;
  expect(useDocumentStore.getState().getDocument(target)?.content).toBe('late-history');
  expect(getCurrentDocumentHistoryContent(target)).toBe('late-history');
});
