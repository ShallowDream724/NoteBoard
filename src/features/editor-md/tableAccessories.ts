import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { annotationId } from './annotations/model';
import { normalizeFigureCaption, renderFigureCaption } from './figureCaption';
import { editFigureCaption, FIGURE_CAPTION_EDIT_EVENT } from './figureCaptionCommands';
import type { mountFigureCaptionEditor } from './figureCaptionEditor';
import './captionAddControl.css';

/** One owned caption follows the table's native width and margins. Its marker
 * is positioned by the table itself, including during live column resizing. */
export class TableAccessories {
  readonly dom = document.createElement('caption');
  private marker = document.createElement('button');
  private label = document.createElement('span');
  private input = document.createElement('div');
  private session: ReturnType<typeof mountFigureCaptionEditor> | null = null;
  private editing = false;
  private node: DocumentNode;
  constructor(node: DocumentNode, private table: HTMLTableElement, private contentDOM: HTMLElement, private view?: EditorView) {
    this.node = node;
    this.dom.className = 'nb-table-accessories'; this.dom.contentEditable = 'false';
    this.marker.type = 'button'; this.marker.className = 'nb-annotation-indicator nb-table-annotation-indicator'; this.marker.textContent = '?';
    this.marker.setAttribute('aria-label', '打开补充说明');
    this.label.className = 'nb-table-caption';
    this.input.className = 'nb-table-caption nb-caption-edit-host';
    // DOM order also keeps the caption below tbody when large tables use the
    // isolated block-row layout instead of native table layout.
    this.dom.append(this.marker, this.label, this.input); table.append(this.dom);
    this.label.addEventListener('click', this.edit);
    this.label.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); this.edit(); } });
    view?.dom.addEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request);
    this.update(node);
  }
  private request = (event: Event) => {
    const { pos } = (event as CustomEvent<{ pos: number }>).detail;
    if (this.view?.nodeDOM(pos) === this.table.parentElement) this.begin();
  };
  private edit = () => {
    const editor = (this.view?.dom as (HTMLElement & { editor?: Editor }) | undefined)?.editor;
    if (editor) editFigureCaption(editor, this.position());
  };
  private position = () => this.view!.posAtDOM(this.contentDOM, 0) - 1;
  private begin = () => {
    if (!this.view?.editable || this.editing) return;
    this.editing = true;
    this.update(this.node);
    void import('./figureCaptionEditor').then(({ mountFigureCaptionEditor }) => {
      if (!this.editing || !this.view || this.view.isDestroyed) return;
      this.session = mountFigureCaptionEditor(this.input, { view: this.view, getPos: this.position, label: '表注', close: this.close });
    });
  };
  private close = () => { this.editing = false; const session = this.session; this.session = null; session?.destroy(); this.input.replaceChildren(); this.update(this.node); };
  update(node: DocumentNode) {
    this.node = node;
    const id = annotationId(node.attrs.annotationId), caption = normalizeFigureCaption(node.attrs.caption);
    this.marker.hidden = !id;
    if (id) this.marker.dataset.annotationId = id; else delete this.marker.dataset.annotationId;
    const editable = !!this.view?.editable;
    this.label.hidden = this.editing || (!caption && !editable);
    renderFigureCaption(this.label, caption, node.attrs.captionContent);
    this.label.tabIndex = editable ? 0 : -1;
    this.label.setAttribute('role', editable ? 'button' : 'text');
    this.label.setAttribute('aria-label', caption ? '编辑表注' : '添加表注');
    if (!caption) this.label.dataset.placeholder = '添加表注'; else delete this.label.dataset.placeholder;
    this.label.classList.toggle('nb-caption-add', !caption);
    this.input.hidden = !this.editing;
    this.dom.classList.toggle('nb-caption-empty', !caption && !this.editing);
    this.dom.hidden = !id && !caption && !this.editing && !editable;
    this.session?.sync();
  }
  owns(target: EventTarget | null) { return target instanceof globalThis.Node && this.dom.contains(target); }
  destroy() { this.editing = false; this.view?.dom.removeEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request); this.session?.destroy(); this.session = null; }
}
