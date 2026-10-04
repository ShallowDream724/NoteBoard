import { create } from 'zustand';

export interface PracticeSession {
  sessionKey: string | null;
  stepId: string;
  completed: readonly string[];
  skipped: readonly string[];
}
interface PracticeStore extends PracticeSession {
  start: (key: string) => void;
  exit: () => void;
  selectStep: (id: string) => void;
  complete: (key: string, id: string) => void;
  skip: (id: string) => void;
  migrateKey: (from: string, to: string) => void;
}
const empty: PracticeSession = { sessionKey: null, stepId: 'selection', completed: [], skipped: [] };

/** Startup-safe state: no course, editor, document or persisted user content. */
export const usePracticeStore = create<PracticeStore>((set) => ({
  ...empty,
  start: sessionKey => set({ ...empty, sessionKey }),
  exit: () => set(empty),
  migrateKey: (from, to) => set(state => state.sessionKey === from ? { sessionKey: to } : {}),
  selectStep: stepId => set(state => state.sessionKey ? { stepId } : {}),
  complete: (key, id) => set(state => state.sessionKey !== key || state.stepId !== id || state.completed.includes(id)
    ? {} : { completed: [...state.completed, id], skipped: state.skipped.filter(item => item !== id) }),
  skip: id => set(state => !state.sessionKey || state.completed.includes(id) || state.skipped.includes(id)
    ? {} : { skipped: [...state.skipped, id] }),
}));
