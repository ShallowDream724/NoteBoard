import { create } from 'zustand';

export interface PracticeSession {
  generation: number;
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
const empty: PracticeSession = { generation: 0, sessionKey: null, stepId: 'read-note', completed: [], skipped: [] };

/** Startup-safe state: no course, editor, document or persisted user content. */
export const usePracticeStore = create<PracticeStore>((set) => ({
  ...empty,
  start: sessionKey => set(state => ({ ...empty, sessionKey, generation: state.generation + 1 })),
  exit: () => set(state => ({ ...empty, generation: state.generation })),
  migrateKey: (from, to) => set(state => state.sessionKey === from ? { sessionKey: to } : {}),
  selectStep: stepId => set(state => state.sessionKey ? { stepId } : {}),
  complete: (key, id) => set(state => state.sessionKey !== key || state.stepId !== id || state.completed.includes(id)
    ? {} : { completed: [...state.completed, id], skipped: state.skipped.filter(item => item !== id) }),
  skip: id => set(state => !state.sessionKey || state.completed.includes(id) || state.skipped.includes(id)
    ? {} : { skipped: [...state.skipped, id] }),
}));
