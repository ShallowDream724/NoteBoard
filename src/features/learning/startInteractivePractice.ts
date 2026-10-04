import { usePracticeStore } from './practiceStore';
import { useWindowStore } from '../../stores/windowStore';
let pendingCreation: Promise<string> | null = null;

/** Call through import() from entry points. Creating a new copy never changes an old one. */
export async function startInteractivePractice(options: { fresh?: boolean } = {}): Promise<string> {
  const existing = usePracticeStore.getState().sessionKey;
  if (!options.fresh && existing && useWindowStore.getState().tabs.some(tab => tab.key === existing && tab.kind === 'noteboard')) {
    useWindowStore.getState().activateTab(existing);
    return existing;
  }
  if (pendingCreation) return pendingCreation;
  const create = async () => {
    const [{ createPracticeContent }, { openNativeTemplate }] = await Promise.all([
      import('./practiceCourse'), import('../welcome/welcomeActions'),
    ]);
    if (usePracticeStore.getState().sessionKey !== existing) throw new Error('练习会话已退出或切换。');
    const key = openNativeTemplate('公园观察练习.nb', createPracticeContent());
    usePracticeStore.getState().start(key);
    return key;
  };
  const pending = create(); pendingCreation = pending;
  try { return await pending; }
  finally { if (pendingCreation === pending) pendingCreation = null; }
}
