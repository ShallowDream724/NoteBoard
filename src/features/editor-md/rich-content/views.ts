import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { ImageCollection, ImageSlot, Disclosure } from './schema';
import { insertLocalImageWithDialog } from '../imagePaste';
import { dispatchDiscreteEdit } from '../discreteEdit';
import './richContent.css';

const arrow = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
function button(label: string, className: string, action: () => void, icon?: string) {
  const el = document.createElement('button'); el.type = 'button'; el.className = className;
  el.title = label; el.setAttribute('aria-label', label); el.contentEditable = 'false';
  if (icon) el.innerHTML = icon; else el.textContent = label;
  el.onmousedown = event => event.preventDefault(); el.onclick = event => { event.preventDefault(); event.stopPropagation(); action(); };
  return el;
}
class CollectionView implements NodeView {
  dom = document.createElement('section'); contentDOM = document.createElement('div');
  private footer = document.createElement('div'); private dots = document.createElement('div');
  private previous: HTMLButtonElement; private next: HTMLButtonElement;
  private active = 0; private frame = 0; private shown: HTMLElement | null = null;
  private dotStart = -1; private dotCount = -1; private counter = document.createElement('span');
  constructor(private node: Node, private editor: Editor, private getPos: () => number | undefined) {
    this.dom.className = 'nb-image-collection'; this.contentDOM.className = 'nb-image-slots';
    this.dom.setAttribute('role', 'group'); this.dom.setAttribute('aria-label', '图片组合');
    this.footer.className = 'nb-image-collection-controls'; this.footer.contentEditable = 'false';
    this.dots.className = 'nb-image-dots'; this.dots.setAttribute('role', 'group'); this.dots.setAttribute('aria-label', '选择图片');
    this.previous = button('上一张图片', 'nb-image-page nb-image-page-previous', () => this.show(this.active - 1), arrow);
    this.next = button('下一张图片', 'nb-image-page', () => this.show(this.active + 1), arrow);
    const add = button('添加一格', 'nb-image-add-slot', () => {
      const pos = this.getPos(); if (pos === undefined) return;
      dispatchDiscreteEdit(this.editor.view, this.editor.state.tr.insert(pos + this.node.nodeSize - 1, this.editor.schema.nodes.imageSlot.create()));
      this.show(this.node.childCount - 1);
    }, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>');
    this.counter.className = 'nb-image-counter'; this.counter.setAttribute('aria-live', 'polite');
    this.footer.append(this.previous, this.dots, this.counter, this.next, add); this.dom.append(this.contentDOM, this.footer); this.refresh();
  }
  private refresh() {
    this.dom.dataset.layout = this.node.attrs.layout;
    this.contentDOM.style.gridTemplateColumns = `repeat(${this.node.attrs.columns},minmax(0,1fr))`;
    this.active = Math.min(this.active, this.node.childCount - 1);
    cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { this.frame = 0; this.show(this.active); });
  }
  private show(index: number) {
    this.dots.children.item(this.active - this.dotStart)?.setAttribute('aria-pressed', 'false');
    this.shown?.removeAttribute('data-active');
    this.active = Math.max(0, Math.min(index, this.node.childCount - 1));
    this.shown = this.contentDOM.children.item(this.active) as HTMLElement | null;
    const count = Math.min(9, this.node.childCount), start = Math.max(0, Math.min(this.active - 4, this.node.childCount - count));
    if (start !== this.dotStart || count !== this.dotCount) {
      this.dotStart = start; this.dotCount = count;
      this.dots.replaceChildren(...Array.from({ length: count }, (_, offset) => {
        const at = start + offset, dot = button(`第 ${at + 1} 张图片`, 'nb-image-dot', () => this.show(at));
        dot.textContent = ''; dot.setAttribute('aria-pressed', 'false'); return dot;
      }));
    }
    this.shown?.setAttribute('data-active', ''); this.dots.children.item(this.active - start)?.setAttribute('aria-pressed', 'true');
    this.counter.hidden = this.node.childCount <= 9; this.counter.textContent = `${this.active + 1} / ${this.node.childCount}`;
    this.previous.disabled = this.active === 0; this.next.disabled = this.active === this.node.childCount - 1;
  }
  update(node: Node) { if (node.type !== this.node.type) return false; const changed = this.node !== node; this.node = node; if (changed) this.refresh(); return true; }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.type === 'attributes' && (mutation.target === this.dom || mutation.target === this.contentDOM) || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return this.footer.contains(event.target as globalThis.Node); }
  destroy() { cancelAnimationFrame(this.frame); }
}
class SlotView implements NodeView {
  dom = document.createElement('figure'); contentDOM = document.createElement('div');
  private add: HTMLButtonElement;
  private caption: HTMLButtonElement;
  constructor(private node: Node, editor: Editor, getPos: () => number | undefined, docKey: string) {
    this.dom.className = 'nb-image-slot'; this.contentDOM.className = 'nb-image-slot-content'; this.dom.dataset.nbImageSlot = ''; this.dom.dataset.imageSlot = '';
    this.add = button('添加图片', 'nb-image-slot-empty', () => { const pos = getPos(); if (pos !== undefined) void insertLocalImageWithDialog(editor, docKey, pos + 1); },
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg><span>添加图片</span>');
    this.caption = button('添加图注', 'nb-image-caption-add', () => {
      const pos = getPos(); if (pos === undefined) return;
      const at = pos + this.node.nodeSize - 1, tr = editor.state.tr.insert(at, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1)); dispatchDiscreteEdit(editor.view, tr); editor.view.focus();
    });
    this.dom.append(this.add, this.contentDOM, this.caption); this.update(node);
  }
  update(node: Node) { if (node.type !== this.node.type) return false; this.node = node; const empty = node.firstChild?.type.name !== 'image'; this.add.hidden = !empty; this.caption.hidden = empty || node.lastChild?.type.name === 'paragraph'; this.dom.dataset.empty = String(empty); return true; }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.target === this.dom || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return this.add.contains(event.target as globalThis.Node) || this.caption.contains(event.target as globalThis.Node); }
}
class DisclosureView implements NodeView {
  dom = document.createElement('section'); contentDOM = document.createElement('div');
  private title = document.createElement('input'); private toggle: HTMLButtonElement; private open: boolean;
  constructor(private node: Node, private editor: Editor, private getPos: () => number | undefined) {
    this.dom.className = 'nb-disclosure'; this.contentDOM.className = 'nb-disclosure-body'; this.open = node.attrs.open;
    const header = document.createElement('div'); header.className = 'nb-disclosure-header'; header.contentEditable = 'false';
    this.toggle = button('收起内容', 'nb-disclosure-toggle', () => { this.open = !this.open; this.paint(); }, arrow);
    this.title.className = 'nb-disclosure-title'; this.title.value = node.attrs.title; this.title.placeholder = '标题'; this.title.setAttribute('aria-label', '折叠块标题');
    this.title.onblur = () => this.commit();
    this.title.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.commit(); this.editor.commands.focus(); } else if (event.key === 'Escape') { this.title.value = this.node.attrs.title; this.title.blur(); this.editor.commands.focus(); } };
    header.append(this.toggle, this.title); this.dom.append(header, this.contentDOM); this.paint();
  }
  private commit() {
    const pos = this.getPos(), title = this.title.value.trim(); if (pos === undefined || title === this.node.attrs.title) return;
    dispatchDiscreteEdit(this.editor.view, this.editor.state.tr.setNodeAttribute(pos, 'title', title));
  }
  private paint() { this.contentDOM.hidden = !this.open; this.dom.dataset.open = String(this.open); this.toggle.setAttribute('aria-expanded', String(this.open)); const label = this.open ? '收起内容' : '展开内容'; this.toggle.title = label; this.toggle.setAttribute('aria-label', label); }
  update(node: Node) { if (node.type !== this.node.type) return false; if (node.attrs.title !== this.node.attrs.title) this.title.value = node.attrs.title; if (node.attrs.open !== this.node.attrs.open) this.open = node.attrs.open; this.node = node; this.paint(); return true; }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.type === 'attributes' && (mutation.target === this.dom || mutation.target === this.contentDOM) || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return !this.contentDOM.contains(event.target as globalThis.Node); }
}
export const InteractiveImageCollection = ImageCollection.extend({ addNodeView() { return ({ node, editor, getPos }) => new CollectionView(node, editor, getPos); } });
export const InteractiveImageSlot = ImageSlot.extend<{ docKey: string }>({ addOptions() { return { docKey: '' }; }, addNodeView() { return ({ node, editor, getPos }) => new SlotView(node, editor, getPos, this.options.docKey); } });
export const InteractiveDisclosure = Disclosure.extend({ addNodeView() { return ({ node, editor, getPos }) => new DisclosureView(node, editor, getPos); } });
