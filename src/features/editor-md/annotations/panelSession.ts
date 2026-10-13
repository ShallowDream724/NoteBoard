import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { annotationIndexKey } from './extension';
import { collectAnnotations } from './model';
import { mapAnnotationTarget, type AnnotationDraftTarget } from './draftTarget';
import type { AnnotationGeometry } from './geometry';

export interface AnnotationPanelState {
  id: string; pinned: boolean; editing: boolean; geometry: AnnotationGeometry;
  trigger: HTMLElement | null; creation?: AnnotationDraftTarget;
  body?: ProseMirrorNode; position?: number; removed?: boolean;
}
const sessions = new WeakMap<Editor, AnnotationPanelSession>();

/** State belongs to one live editor; hidden panels own no view or DOM node. */
class AnnotationPanelSession {
  private panels: AnnotationPanelState[] = [];
  private drafts = new Map<string, EditorState>();
  private subscribers = new Set<() => void>();
  private listening = false;
  constructor(private editor: Editor) {}
  snapshot = () => this.panels;
  subscribe = (listener: () => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
      if (!this.subscribers.size) this.set(current => current.filter(panel => panel.pinned || panel.editing).map(panel => ({ ...panel, trigger: null })));
    };
  };
  set = (update: (panels: AnnotationPanelState[]) => AnnotationPanelState[]) => {
    this.panels = update(this.panels);
    for (const id of this.drafts.keys()) if (!this.panels.some(panel => panel.id === id && panel.editing)) this.drafts.delete(id);
    if (this.panels.length && !this.listening) {
      this.listening = true; this.editor.on('transaction', this.update); this.editor.on('destroy', this.destroy);
    } else if (!this.panels.length && this.listening) this.detach();
    for (const listener of this.subscribers) listener();
  };
  draft = (id: string) => this.drafts.get(id);
  retainDraft = (id: string, state: EditorState) => {
    if (this.panels.some(panel => panel.id === id && panel.editing)) this.drafts.set(id, state);
  };
  hasDraft = () => this.panels.some(panel => panel.editing);
  private update = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    const records = annotationIndexKey.getState(this.editor.state)?.records ?? collectAnnotations(this.editor.state.doc);
    this.set(current => current.flatMap<AnnotationPanelState>(panel => {
      if (panel.creation) return [{ ...panel, creation: mapAnnotationTarget(panel.creation, transaction) }];
      const mapped = panel.position === undefined ? undefined : transaction.mapping.mapResult(panel.position, 1);
      const replacedWhileHidden = !this.subscribers.size && panel.editing && mapped?.deleted;
      // Once removed, a draft never attaches itself to a later reused id.
      if (panel.removed || replacedWhileHidden || !records.has(panel.id)) return panel.editing ? [{ ...panel, removed: true }] : [];
      return [{ ...panel, position: records.get(panel.id)?.pos }];
    }));
  };
  private detach = () => {
    this.editor.off('transaction', this.update); this.editor.off('destroy', this.destroy); this.listening = false;
  };
  private destroy = () => { this.detach(); this.panels = []; this.drafts.clear(); sessions.delete(this.editor); for (const listener of this.subscribers) listener(); };
}

export function annotationPanelSession(editor: Editor) {
  let session = sessions.get(editor);
  if (!session) { session = new AnnotationPanelSession(editor); sessions.set(editor, session); }
  return session;
}
export function hasAnnotationDraft(editor: Editor | null | undefined): boolean { return editor ? sessions.get(editor)?.hasDraft() ?? false : false; }
