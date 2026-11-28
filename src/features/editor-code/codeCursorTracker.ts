import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { CodeCursorPosition, CodeCursorSource } from '../../core/editor/editorTypes';

/** Read logical coordinates only while a consumer observes this editor. */
export const codeCursorTracker = ViewPlugin.fromClass(class implements CodeCursorSource {
  private position?: CodeCursorPosition;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly view: EditorView) {}

  getSnapshot = () => {
    const { doc, selection } = this.view.state;
    const head = selection.main.head;
    const line = doc.lineAt(head);
    const column = head - line.from + 1;
    if (this.position?.line !== line.number || this.position.column !== column) {
      this.position = { line: line.number, column };
    }
    return this.position;
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  update({ docChanged, selectionSet }: ViewUpdate) {
    if (!this.listeners.size || !(selectionSet || docChanged)) return;
    const previous = this.position;
    if (this.getSnapshot() !== previous) this.listeners.forEach(listener => listener());
  }

  destroy() { this.listeners.clear(); }
});
