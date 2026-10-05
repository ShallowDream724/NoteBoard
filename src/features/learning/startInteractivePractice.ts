import { usePracticeStore } from './practiceStore';
import { useWindowStore } from '../../stores/windowStore';
/** Attach to the actual sample tab; never create a second practice document. */
export function startShowcaseGuide(key: string): void {
  if (useWindowStore.getState().tabs.some(tab => tab.key === key && tab.kind === 'noteboard')) usePracticeStore.getState().start(key);
}
