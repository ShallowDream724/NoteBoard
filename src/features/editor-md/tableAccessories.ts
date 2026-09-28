import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { annotationId } from './annotations/model';
import { normalizeFigureCaption, renderFigureCaption } from './figureCaption';
import { editFigureCaption, FIGURE_CAPTION_EDIT_EVENT } from './figureCaptionCommands';
import { FigureCaptionTransition } from './figureCaptionTransition';
import './captionAddControl.css';

/** One owned caption follows the table's native width and margins. Its marker
 * is positioned by the table itself, including during live column resizing. */
export class TableAccessories {
  readonly dom = document.createElement('caption');
  private marker = document.createElement('button');
  private label = document.createElement('span');
  private input = document.createElement('div');
  private transition: FigureCaptionTransition | null = null;
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
    if (view) this.transition = new FigureCaptionTransition(this.label, this.input, {
      view, getPos: this.position, label: '表注', onEditingChange: editing => { this.editing = editing; this.update(this.node); },
    });
    this.label.addEventListener('pointerdown', this.preserveSelection);
    this.label.addEventListener('mousedown', this.preserveSelection);
    this.label.addEventListener('click', this.edit);
    this.label.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); this.edit(); } });
    view?.dom.addEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request);
    this.update(node);
  }
  private request = (event: Event) => {
    const { pos } = (event as CustomEvent<{ pos: number }>).detail;
    if (this.view?.nodeDOM(pos) === this.table.parentElement) this.transition?.begin();
  };
  private edit = () => {
    const editor = (this.view?.dom as (HTMLElement & { editor?: Editor }) | undefined)?.editor;
    if (editor) editFigureCaption(editor, this.position());
  };
  private preserveSelection = (event: Event) => {
    if (!this.view?.editable) return;
    event.preventDefault(); event.stopPropagation();
  };
  private position = () => this.view!.posAtDOM(this.contentDOM, 0) - 1;
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
    this.transition?.sync();
  }
  owns(target: EventTarget | null) { return target instanceof globalThis.Node && this.dom.contains(target); }
  destroy() { this.view?.dom.removeEventListener(FIGURE_CAPTION_EDIT_EVENT, this.request); this.transition?.destroy(); this.transition = null; }
}
