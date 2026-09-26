import { useSettingsStore } from '../../stores/settingsStore';
import { useWindowStore } from '../../stores/windowStore';
import { openShowcase } from './welcomeActions';
import type { WindowBootDto } from '../../core/ipc/types';

export const INTRODUCTION_SEEN_KEY = 'noteboard.introduction-seen';

/** Run after queued opens and session restoration, so the user's documents win. */
export async function openFirstRunShowcase(startupMode: WindowBootDto['startupMode']): Promise<string | undefined> {
  if (
    localStorage.getItem(INTRODUCTION_SEEN_KEY)
    || startupMode !== 'empty'
    || useSettingsStore.getState().settings.revision !== 0
    || useWindowStore.getState().tabs.length > 0
  ) return;

  const key = await openShowcase(true);
  // Asset preparation can fail or a queued file can arrive while it runs.
  // Keep the introduction eligible until its editable tab actually opens.
  if (key) localStorage.setItem(INTRODUCTION_SEEN_KEY, '1');
  return key;
}
