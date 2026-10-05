import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/stores/windowStore', async () => {
  const { create } = await import('zustand');
  return { useWindowStore: create(() => ({ tabs: [], activeKey: null })) };
});
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { startShowcaseGuide } from '../../src/features/learning/startInteractivePractice';
const tab = (key: string, kind: Tab['kind']): Tab => ({ key, kind, displayName: `${key}.nb`, path: null, language: '', isDirty: true, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
afterEach(() => { usePracticeStore.getState().exit(); useWindowStore.setState({ tabs: [], activeKey: null }); });
it('attaches to the existing NB sample without replacing tabs or resetting unsaved state', () => {
  const tabs = [tab('showcase', 'noteboard')];
  useWindowStore.setState({ tabs, activeKey: 'showcase' }); startShowcaseGuide('showcase');
  expect(usePracticeStore.getState().sessionKey).toBe('showcase'); expect(usePracticeStore.getState().stepId).toBe('read-note');
  expect(useWindowStore.getState().tabs).toBe(tabs); expect(tabs[0].isDirty).toBe(true);
});
it('rejects a missing tab or a tab with the wrong document format', () => {
  useWindowStore.setState({ tabs: [tab('markdown', 'markdown')] });
  startShowcaseGuide('missing'); expect(usePracticeStore.getState().sessionKey).toBeNull();
  startShowcaseGuide('markdown'); expect(usePracticeStore.getState().sessionKey).toBeNull();
});
