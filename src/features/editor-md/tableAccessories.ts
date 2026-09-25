import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { annotationId } from './annotations/model';
import { FIGURE_CAPTION_MAX_LENGTH, normalizeFigureCaption } from './figureCaption';
import { FIGURE_CAPTION_EDIT_EVENT, setFigureCaption } from './figureCaptionCommands';

/** One owned caption follows the table's native width and margins. Its marker
 * is positioned by the table itself, including during live column resizing. */
export class TableAccessories {
  readonly dom = document.createElement('caption');
  private marker = document.createElement('button');
  private label = document.createElement('button');
  private input = document.createElement('textarea');
  private editing = false;
  private node: DocumentNode;
  constructor(node: DocumentNode, private table: HTMLTableElement, private contentDOM: HTMLElement, private view?: EditorView) {
    this.node = node;
    this.dom.className = 'nb-table-accessories'; this.dom.contentEditable = 'false';
    this.marker.type = 'button'; this.marker.className = 'nb-annotation-indicator nb-table-annotation-indicator'; this.marker.textContent = '?';
    this.marker.setAttribute('aria-label', '打开补充说明');
    this.label.type = 'button'; this.label.className = 'nb-table-caption'; this.label.setAttribute('aria-label', '编辑表注');
    this.input.className = 'nb-table-caption-input'; this.input.setAttribute('aria-label', '表注'); this.input.placeholder = '输入表注';
    this.input.maxLength = FIGURE_CAPTION_MAX_LENGTH; this.input.dataset.shortcutsSuspended = 'true';
    // DOM order also keeps the caption below tbody when large tables use the
    // isolated block-row layout instead of native table layout.
    this.dom.append(this.marker, this.label, this.input); table.append(this.dom);
    this.label.addEventListener('click', this.begin);
    this.input.addEventListener('keydown', this.keydown); this.input.addEventListener('blur', this.commit);
    this.input.addEventListener('input', this.resizeInput);
    view?.dom.addEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request);
    this.update(node);
  }
  private request = (event: Event) => {
    const { pos } = (event as CustomEvent<{ pos: number }>).detail;
    if (this.view?.nodeDOM(pos) === this.table.parentElement) this.begin();
  };
  private begin = () => {
    if (!this.view?.editable) return;
    this.editing = true; this.input.value = normalizeFigureCaption(this.node.attrs.caption) ?? '';
    this.update(this.node); this.resizeInput(); this.input.focus({ preventScroll: true });
  };
  private resizeInput = () => { this.input.rows = Math.max(1, Math.min(6, this.input.value.split('\n').length)); };
  private commit = () => {
    if (!this.editing || !this.view) return;
    this.editing = false;
    const pos = this.view.posAtDOM(this.contentDOM, 0) - 1;
    setFigureCaption(this.view, pos, this.input.value);
    this.update(this.node);
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.editing = false; this.update(this.node); this.view?.dom.focus({ preventScroll: true }); }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); this.commit(); this.view?.dom.focus({ preventScroll: true }); }
  };
  update(node: DocumentNode) {
    this.node = node;
    const id = annotationId(node.attrs.annotationId), caption = normalizeFigureCaption(node.attrs.caption);
    this.marker.hidden = !id;
    if (id) this.marker.dataset.annotationId = id; else delete this.marker.dataset.annotationId;
    this.label.hidden = this.editing || !caption; this.label.textContent = caption;
    this.label.disabled = !this.view?.editable;
    this.input.hidden = !this.editing;
    this.dom.hidden = !id && !caption && !this.editing;
  }
  owns(target: EventTarget | null) { return target instanceof globalThis.Node && this.dom.contains(target); }
  destroy() { this.view?.dom.removeEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request); }
}
