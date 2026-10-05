import { afterEach, expect, it } from 'vitest';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
afterEach(() => usePracticeStore.getState().exit());
it('keeps skip, completion and exit scoped to the current session and step', () => {
  const store = usePracticeStore.getState(); store.start('practice-1'); store.selectStep('selection'); store.skip('selection');
  expect(usePracticeStore.getState().skipped).toEqual(['selection']);
  store.complete('other', 'selection'); expect(usePracticeStore.getState().completed).toEqual([]);
  store.complete('practice-1', 'selection'); expect(usePracticeStore.getState().completed).toEqual(['selection']); expect(usePracticeStore.getState().skipped).toEqual([]);
  store.selectStep('highlight'); store.complete('practice-1', 'selection'); expect(usePracticeStore.getState().stepId).toBe('highlight');
  store.exit(); expect(usePracticeStore.getState().sessionKey).toBeNull(); expect(usePracticeStore.getState().completed).toEqual([]);
});
it('restarting uses a new key and resets task progress; identity migration preserves it', () => {
  const store = usePracticeStore.getState(); store.start('first'); store.selectStep('selection'); store.complete('first', 'selection'); store.migrateKey('first', 'saved.nb');
  expect(usePracticeStore.getState().sessionKey).toBe('saved.nb'); expect(usePracticeStore.getState().completed).toEqual(['selection']);
  store.start('second'); expect(usePracticeStore.getState().sessionKey).toBe('second'); expect(usePracticeStore.getState().completed).toEqual([]);
});
