import { afterEach, expect, it, vi } from 'vitest';
import { clearAllDocumentHistories, getCurrentDocumentHistoryContent, initializeDocumentHistory, isApplyingDocumentHistory, recordDocumentChange, redoDocumentHistory, registerDocumentHistoryAdapter, subscribeDocumentHistoryNavigation, undoDocumentHistory } from '../../src/features/history/documentHistory';
const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); clearAllDocumentHistories(); vi.restoreAllMocks(); });
function prepare(apply = vi.fn()) {
  initializeDocumentHistory('practice', 'A', 'visual');
  stops.push(registerDocumentHistoryAdapter('practice', { applyEntry: apply }));
  recordDocumentChange('practice', 'AB', { mode: 'visual', startsNewGroup: true });
}
it('publishes successful unified undo and redo after the adapter finishes, without content', () => {
  const apply = vi.fn(); prepare(apply);
  const listener = vi.fn((key: string) => { expect(isApplyingDocumentHistory(key)).toBe(false); expect(apply).toHaveBeenCalled(); });
  stops.push(subscribeDocumentHistoryNavigation(listener));
  expect(undoDocumentHistory('practice')).toBe(true); expect(redoDocumentHistory('practice')).toBe(true);
  expect(listener.mock.calls).toEqual([['practice', 'undo'], ['practice', 'redo']]);
});
it('does not publish failed applications or impossible navigation', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); prepare(vi.fn(() => { throw Error('cannot apply'); }));
  const listener = vi.fn(); stops.push(subscribeDocumentHistoryNavigation(listener));
  expect(undoDocumentHistory('practice')).toBe(false); expect(redoDocumentHistory('practice')).toBe(false);
  expect(listener).not.toHaveBeenCalled(); expect(getCurrentDocumentHistoryContent('practice')).toBe('AB');
});
it('isolates listener failures and allows unsubscribe without rolling back successful navigation', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); prepare();
  const bad = vi.fn(() => { throw Error('observer failed'); }), good = vi.fn();
  stops.push(subscribeDocumentHistoryNavigation(bad));
  const stop = subscribeDocumentHistoryNavigation(good); stops.push(stop);
  expect(undoDocumentHistory('practice')).toBe(true); expect(good).toHaveBeenCalledWith('practice', 'undo');
  expect(getCurrentDocumentHistoryContent('practice')).toBe('A'); stop();
  expect(redoDocumentHistory('practice')).toBe(true); expect(good).toHaveBeenCalledTimes(1);
});
