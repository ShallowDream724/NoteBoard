// 暂存判定测试：空白未命名文件可直接关闭，其余未保存工作必须受到保护。

import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { hasUnsavedWork } from '../../src/features/staging/stagingPolicy';
import { registerEditorCapabilities, resetEditorRegistryForTest } from '../../src/core/editor/editorRegistry';

function openTestDocument(key: string, content: string, isDirty = false): void {
  useDocumentStore.getState().upsertFromPayload({
    key,
    displayName: '未命名.md',
    dirPath: '',
    kind: 'markdown',
    language: 'markdown',
    content,
    encoding: 'utf8',
    eol: 'lf',
    size: content.length,
    mtime: 0,
    readonly: false,
  });
  useDocumentStore.getState().setDirty(key, isDirty);
  const tab: Tab = {
    key,
    displayName: '未命名.md',
    path: key.startsWith('untitled:') ? null : key,
    kind: 'markdown',
    language: 'markdown',
    isDirty,
    isPreview: false,
    viewMode: 'visual',
    externalStatus: null,
    isDetached: false,
  };
  useWindowStore.getState().openTab(tab);
}

describe('hasUnsavedWork', () => {
  beforeEach(() => {
    resetEditorRegistryForTest();
    useDocumentStore.setState({ documents: new Map() });
    useWindowStore.setState({ tabs: [], activeKey: null, pendingCloseKeys: [], isWindowClosing: false });
  });

  it('空白未命名文件无需保存或暂存', () => {
    openTestDocument('untitled:markdown:1', '');
    expect(hasUnsavedWork('untitled:markdown:1')).toBe(false);
  });

  it('带默认内容的未命名文件需要保存或暂存', () => {
    openTestDocument('untitled:json:1', '{\n  "enabled": true\n}');
    expect(hasUnsavedWork('untitled:json:1')).toBe(true);
  });

  it('即使内容只有空格，只要已编辑为脏态也需要保护', () => {
    openTestDocument('untitled:text:1', ' ', true);
    expect(hasUnsavedWork('untitled:text:1')).toBe(true);
  });

  it('未修改的磁盘文件不进入暂存', () => {
    openTestDocument('C:\\notes\\saved.md', 'saved');
    expect(hasUnsavedWork('C:\\notes\\saved.md')).toBe(false);
  });

  it('protects explicit child drafts without treating all unconfirmed parent input as an explicit draft', () => {
    const key = 'C:\\notes\\saved.nb'; openTestDocument(key, 'saved');
    let draft = true;
    const release = registerEditorCapabilities({ docKey: key, instanceId: 'child-draft', getRevision: () => 0, flush: async () => null, focus: () => {}, getSelectedText: () => '', canSuspend: () => false, hasExplicitDraft: () => draft, hasUnconfirmedInput: () => true });
    expect(hasUnsavedWork(key)).toBe(true); draft = false; expect(hasUnsavedWork(key)).toBe(false); release();
  });

  it.each(['tab', 'left', 'right', 'other', 'all', 'batch'] as const)('keeps a saved document with an explicit draft during request close %s, but permits explicit discard', action => {
    const left = 'C:\\notes\\left.nb', key = 'C:\\notes\\draft.nb', right = 'C:\\notes\\right.nb';
    for (const current of [left, key, right]) openTestDocument(current, 'saved');
    const release = registerEditorCapabilities({ docKey: key, instanceId: 'child-draft', getRevision: () => 0, flush: async () => null, focus: () => {}, getSelectedText: () => '', canSuspend: () => false, hasExplicitDraft: () => true });
    const store = useWindowStore.getState();
    if (action === 'tab') store.requestCloseTab(key);
    else if (action === 'left') store.requestCloseLeft(right);
    else if (action === 'right') store.requestCloseRight(left);
    else if (action === 'other') store.requestCloseOther(left);
    else if (action === 'all') store.requestCloseAll();
    else store.requestCloseBatch([key]);
    expect(useWindowStore.getState().getTab(key)).not.toBeNull(); expect(useWindowStore.getState().pendingCloseKeys).toContain(key);
    const targets = [...useWindowStore.getState().pendingCloseKeys]; store.confirmCloseBatch(targets);
    expect(useWindowStore.getState().getTab(key)).toBeNull(); release();
  });
});
