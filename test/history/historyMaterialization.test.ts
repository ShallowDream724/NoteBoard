import { beforeEach, expect, it } from 'vitest';
import {
  __debugGetState,
  clearAllDocumentHistories,
  getCurrentDocumentHistoryContent,
  initializeDocumentHistory,
  recordDocumentChange,
  redoDocumentHistory,
  registerDocumentHistoryAdapter,
  undoDocumentHistory,
} from '../../src/features/history/documentHistory';

const KEY = 'materialization.md';

function seedHistory(groups: number, prefix = '正文'.repeat(100)) {
  initializeDocumentHistory(KEY, prefix, 'source');
  for (let i = 1; i <= groups; i += 1) {
    recordDocumentChange(KEY, `${prefix}${i}`, { mode: 'source', startsNewGroup: true });
  }
  registerDocumentHistoryAdapter(KEY, { applyEntry: () => {} });
  return { state: __debugGetState(KEY)!, prefix };
}

// Every forward or reverse application reads the inserted fragment once.
// Count actual patch work instead of a wall-clock threshold sensitive to CI load.
function countPatchApplications() {
  let count = 0;
  for (const node of __debugGetState(KEY)!.entries) {
    const patch = node.patch;
    if (!patch) continue;
    const inserted = patch.inserted;
    Object.defineProperty(patch, 'inserted', {
      configurable: true,
      get: () => {
        count += 1;
        return inserted;
      },
    });
  }
  return () => count;
}

beforeEach(clearAllDocumentHistories);

it('百万字符当前快照的重复读取及下一组记录不重放已缓存补丁', () => {
  const { prefix } = seedHistory(19, '文'.repeat(1_000_000));
  const applications = countPatchApplications();
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}19`);
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}19`);
  recordDocumentChange(KEY, `${prefix}20`, { mode: 'source', startsNewGroup: true });
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}20`);
  expect(applications()).toBe(0);
});

it('跨检查点撤销后从检查点继续重做只应用目标的一个补丁', () => {
  const { state, prefix } = seedHistory(22);
  expect(undoDocumentHistory(KEY)).toBe(true);
  expect(undoDocumentHistory(KEY)).toBe(true);
  expect(state.entries[state.index].checkpoint).toBe(`${prefix}20`);
  expect(state.lastMaterialized).toEqual({ index: 20, content: `${prefix}20` });
  const applications = countPatchApplications();
  expect(redoDocumentHistory(KEY)).toBe(true);
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}21`);
  expect(applications()).toBe(1);
});

it('历史裁剪重定位当前缓存，随后读取与分支仍恢复正确全文', () => {
  const { state, prefix } = seedHistory(219);
  expect(state.entries).toHaveLength(201);
  expect(state.lastMaterialized).toEqual({ index: 200, content: `${prefix}219` });
  const applications = countPatchApplications();
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}219`);
  expect(applications()).toBe(0);
  expect(undoDocumentHistory(KEY)).toBe(true);
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}218`);
  expect(applications()).toBe(1);
  recordDocumentChange(KEY, `${prefix}分支`, { mode: 'source', startsNewGroup: true });
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}分支`);
  expect(redoDocumentHistory(KEY)).toBe(false);
  expect(undoDocumentHistory(KEY)).toBe(true);
  expect(getCurrentDocumentHistoryContent(KEY)).toBe(`${prefix}218`);
});
