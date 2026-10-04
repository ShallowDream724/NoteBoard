import { afterEach, expect, it, vi } from 'vitest';
const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../src/features/welcome/welcomeActions', () => ({ openNativeTemplate: factory.create }));
vi.mock('../../src/stores/windowStore', async () => {
  const { create } = await import('zustand');
  const store = create(() => ({ tabs: [], activeKey: null, activateTab: (key: string) => store.setState({ activeKey: key } as never) }));
  return { useWindowStore: store };
});
import { useWindowStore, type Tab } from '../../src/stores/windowStore';
import { usePracticeStore } from '../../src/features/learning/practiceStore';
import { startInteractivePractice } from '../../src/features/learning/startInteractivePractice';
afterEach(() => { usePracticeStore.getState().exit(); factory.create.mockReset(); useWindowStore.setState({ tabs: [], activeKey: null }); });
it('resumes an existing owned practice without recreating content or resetting progress', async () => {
  useWindowStore.setState({ tabs: [{ key: 'practice', kind: 'noteboard' } as Tab], activeKey: 'other' });
  usePracticeStore.getState().start('practice'); usePracticeStore.getState().complete('practice', 'selection');
  expect(await startInteractivePractice()).toBe('practice'); expect(factory.create).not.toHaveBeenCalled();
  expect(useWindowStore.getState().activeKey).toBe('practice'); expect(usePracticeStore.getState().completed).toEqual(['selection']);
});
it('explicit restart creates a new NB copy and leaves the old tab intact', async () => {
  const tabs = [{ key: 'old', kind: 'noteboard' } as Tab]; useWindowStore.setState({ tabs }); usePracticeStore.getState().start('old');
  factory.create.mockReturnValue('new'); expect(await startInteractivePractice({ fresh: true })).toBe('new');
  expect(factory.create).toHaveBeenCalledWith('公园观察练习.nb', expect.stringContaining('#!noteboard 1'));
  expect(useWindowStore.getState().tabs).toBe(tabs); expect(usePracticeStore.getState().sessionKey).toBe('new');
});
it('coalesces repeated start clicks into one copy and cancels restart if the user exits during loading', async () => {
  factory.create.mockReturnValue('first');
  expect(await Promise.all([startInteractivePractice(), startInteractivePractice()])).toEqual(['first', 'first']);
  expect(factory.create).toHaveBeenCalledTimes(1);
  const pending = startInteractivePractice({ fresh: true }); usePracticeStore.getState().exit();
  await expect(pending).rejects.toThrow('已退出或切换'); expect(factory.create).toHaveBeenCalledTimes(1);
});
