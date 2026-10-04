import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/stores/windowStore', async () => {
  const { create } = await import('zustand');
  return { useWindowStore: create(() => ({ tabs: [], activeKey: null })) };
});
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { trackPracticeTab } from '../../src/features/learning/practiceLifecycle';

const tab = (key: string, path: string | null = null) => ({ key, path, kind: 'noteboard' }) as Tab;
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; usePracticeStore.getState().exit(); });
it('preserves progress on another active tab, and exits when the owned tab closes', () => {
  useWindowStore.setState({ tabs: [tab('practice'), tab('other')], activeKey: 'practice' });
  usePracticeStore.getState().start('practice'); stop = trackPracticeTab();
  useWindowStore.setState({ activeKey: 'other' }); expect(usePracticeStore.getState().sessionKey).toBe('practice');
  useWindowStore.setState({ tabs: [tab('other')] }); expect(usePracticeStore.getState().sessionKey).toBeNull();
});
it('follows the same atomic NB tab identity and refuses unrelated replacement', () => {
  useWindowStore.setState({ tabs: [tab('practice'), tab('other')] });
  usePracticeStore.getState().start('practice'); usePracticeStore.getState().complete('practice', 'selection'); stop = trackPracticeTab();
  useWindowStore.setState({ tabs: [tab('saved.nb', 'saved.nb'), tab('other')] });
  expect(usePracticeStore.getState().sessionKey).toBe('saved.nb'); expect(usePracticeStore.getState().completed).toEqual(['selection']);
  useWindowStore.setState({ tabs: [tab('unrelated'), tab('other')] }); expect(usePracticeStore.getState().sessionKey).toBeNull();
});
it('unsubscribes without closing or changing the practice document', () => {
  const tabs = [tab('practice')]; useWindowStore.setState({ tabs }); usePracticeStore.getState().start('practice');
  stop = trackPracticeTab(); stop(); stop = undefined;
  useWindowStore.setState({ tabs: [] }); expect(usePracticeStore.getState().sessionKey).toBe('practice');
});
it('clears a session whose tab closed before the shell lifecycle attached', () => {
  useWindowStore.setState({ tabs: [] }); usePracticeStore.getState().start('missing');
  stop = trackPracticeTab();
  expect(usePracticeStore.getState().sessionKey).toBeNull();
});
