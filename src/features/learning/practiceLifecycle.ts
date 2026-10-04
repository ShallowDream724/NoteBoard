import { useWindowStore } from '../../stores/windowStore';
import { usePracticeStore } from './practiceStore';

/** Tab identity publication is atomic. No document contents are accessed. */
export function trackPracticeTab(): () => void {
  const current = usePracticeStore.getState();
  if (current.sessionKey && !useWindowStore.getState().tabs.some(tab => tab.key === current.sessionKey)) current.exit();
  return useWindowStore.subscribe((state, previous) => {
    const { sessionKey, exit, migrateKey } = usePracticeStore.getState();
    if (!sessionKey || state.tabs === previous.tabs || state.tabs.some(tab => tab.key === sessionKey)) return;
    const index = previous.tabs.findIndex(tab => tab.key === sessionKey);
    const replacement = state.tabs[index];
    const migrated = index >= 0 && state.tabs.length === previous.tabs.length && replacement?.path === replacement?.key
      && replacement?.kind === 'noteboard' && state.tabs.every((tab, at) => at === index || tab.key === previous.tabs[at].key);
    if (migrated) migrateKey(sessionKey, replacement.key);
    else exit();
  });
}
