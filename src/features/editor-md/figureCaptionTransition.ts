import type { EditorView } from '@tiptap/pm/view';
import { showToast } from '../../stores/toastStore';
import type { mountFigureCaptionEditor } from './figureCaptionEditor';
import { isEditingScopeInteraction, registerExternalEditingScope } from './editingScope';

type CaptionEditorModule = typeof import('./figureCaptionEditor');
const preparing = new WeakMap<EditorView, FigureCaptionTransition>();

/** Keep the rendered caption until its lazy editor is ready. A pending request
 * owns no focus: leaving the caption cancels it, including while a chunk loads. */
export class FigureCaptionTransition {
  private session: ReturnType<typeof mountFigureCaptionEditor> | null = null;
  private pending: object | null = null;
  private releasePendingScope: (() => void) | null = null;
  private destroyed = false;

  constructor(private preview: HTMLElement, private host: HTMLElement, private options: {
    view: EditorView; getPos: () => number | undefined; label: string; onEditingChange: (editing: boolean) => void;
  }, private load: () => Promise<CaptionEditorModule> = () => import('./figureCaptionEditor')) {}

  begin = () => {
    const { view } = this.options;
    if (this.destroyed || this.pending || this.session || view.isDestroyed || !view.editable) return;
    preparing.get(view)?.cancelPending();
    const request = this.pending = {};
    this.releasePendingScope = registerExternalEditingScope(view);
    preparing.set(view, this);
    document.addEventListener('pointerdown', this.leave, true);
    document.addEventListener('focusin', this.leave, true);
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('blur', this.cancelPending);
    void this.load().then(({ mountFigureCaptionEditor }) => {
      if (this.pending !== request) return;
      if (this.destroyed || view.isDestroyed || !view.editable || !this.host.isConnected) { this.cancelPending(); return; }
      this.session = mountFigureCaptionEditor(this.host, { ...this.options, close: this.close });
      this.cancelPending();
      // Mounting fills the hidden host synchronously. Swap once, then focus the
      // visible editor so neither a blank frame nor a hidden focus target exists.
      this.preview.hidden = true; this.host.hidden = false;
      this.options.onEditingChange(true);
      this.session?.focus();
    }).catch(() => {
      if (this.destroyed || this.pending !== request) return;
      this.close();
      showToast(`${this.options.label}编辑器加载失败，请重试`, 'error');
    });
  };

  private leave = (event: Event) => {
    const target = event.target;
    if (isEditingScopeInteraction(target)) return;
    if (!(target instanceof globalThis.Node) || (!this.preview.contains(target) && !this.host.contains(target))) this.cancelPending();
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') this.cancelPending();
    else this.leave(event);
  };
  private cancelPending = () => {
    this.pending = null;
    this.releasePendingScope?.(); this.releasePendingScope = null;
    if (preparing.get(this.options.view) === this) preparing.delete(this.options.view);
    document.removeEventListener('pointerdown', this.leave, true);
    document.removeEventListener('focusin', this.leave, true);
    document.removeEventListener('keydown', this.key, true);
    window.removeEventListener('blur', this.cancelPending);
  };
  close = () => {
    this.cancelPending();
    const session = this.session; this.session = null;
    session?.destroy(); this.host.replaceChildren();
    this.preview.hidden = false; this.host.hidden = true;
    this.options.onEditingChange(false);
  };
  sync() { this.session?.sync(); }
  destroy() { this.destroyed = true; this.close(); }
}
