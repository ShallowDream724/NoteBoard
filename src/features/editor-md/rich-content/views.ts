import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { Decoration, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { createDisclosureTriangle } from '../../../components/DisclosureTriangle';
import { ImageCollection, ImageSlot, Disclosure } from './schema';
import { insertLocalImageWithDialog } from '../imagePaste';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { collectionPresentation } from './collectionPresentation';
import { annotationMarkerId, createAnnotationMarker, updateAnnotationMarker } from '../annotations/marker';
import { continueContainerWriting, handleContainerTailKey, needsContainerTail } from '../containerEditing';
import { observeImageViewport } from './imageVisibility';
import './richContent.css';
import './carousel.css';
import '../captionAddControl.css';

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
  private viewport = document.createElement('div'); private pagination = document.createElement('div');
  private footer = document.createElement('div'); private dots = document.createElement('div');
  private previous: HTMLButtonElement; private next: HTMLButtonElement;
  private active = 0; private frame = 0; private shown: HTMLElement | null = null;
  private dotStart = -1; private dotCount = -1; private counter = document.createElement('span');
  private target: number | null = null; private scrollFrame = 0; private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private resize: ResizeObserver | undefined; private width = 0; private nearby = new Set<HTMLElement>();
  private annotation: HTMLSpanElement;
  private inViewport = false; private stopViewport: () => void;
  constructor(private node: Node, private editor: Editor, private getPos: () => number | undefined, decorations: readonly Decoration[]) {
    this.dom.className = 'nb-image-collection'; this.contentDOM.className = 'nb-image-slots';
    this.viewport.className = 'nb-image-viewport'; this.pagination.className = 'nb-image-pagination';
    this.dom.setAttribute('role', 'group'); this.dom.setAttribute('aria-label', '图片组合');
    this.footer.className = 'nb-image-collection-controls'; this.footer.contentEditable = 'false';
    this.dots.className = 'nb-image-dots'; this.dots.setAttribute('role', 'group'); this.dots.setAttribute('aria-label', '选择图片');
    this.previous = button('上一张图片', 'nb-image-page nb-image-page-previous', () => this.show(this.active - 1), arrow);
    this.next = button('下一张图片', 'nb-image-page', () => this.show(this.active + 1), arrow);
    const add = button('添加一格', 'nb-image-add-slot', () => {
      const pos = this.getPos(); if (pos === undefined) return;
      dispatchDiscreteEdit(this.editor.view, this.editor.state.tr.insert(pos + this.node.nodeSize - 1, this.editor.schema.nodes.imageSlot.create()));
      this.show(this.node.childCount - 1);
      this.editor.view.focus();
    }, '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>');
    // Keep live regions out of the editable tree: modal aria isolation would
    // otherwise mutate all sibling blocks and force ProseMirror to reparse them.
    this.counter.className = 'nb-image-counter';
    this.pagination.append(this.dots, this.counter);
    this.annotation = createAnnotationMarker(annotationMarkerId(decorations), 'edge');
    this.footer.append(this.previous, this.pagination, this.next, add); this.viewport.append(this.contentDOM); this.dom.append(this.viewport, this.footer, this.annotation);
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    this.viewport.addEventListener('wheel', this.onWheel, { passive: true });
    this.viewport.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    if (typeof ResizeObserver !== 'undefined') { this.resize = new ResizeObserver(() => {
      const width = this.viewport.clientWidth; if (!width || width === this.width) return;
      this.width = width; if (this.node.attrs.layout === 'carousel') this.show(this.active, false);
    }); this.resize.observe(this.viewport); }
    this.stopViewport = observeImageViewport(this.dom, entry => { this.inViewport = entry.isIntersecting; this.prepareAdjacentImages(); });
    this.refresh();
  }
  private refresh() {
    this.dom.dataset.layout = this.node.attrs.layout;
    this.dom.style.cssText = collectionPresentation(this.node.attrs).style;
    this.contentDOM.style.gridTemplateColumns = `repeat(${this.node.attrs.columns},minmax(0,1fr))`;
    this.active = Math.min(this.active, this.node.childCount - 1);
    cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { this.frame = 0; this.show(this.active, false); });
  }
  private onPointerDown = () => { this.target = null; };
  private onWheel = (event: WheelEvent) => { if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) this.target = null; };
  private onScroll = () => {
    if (this.node.attrs.layout !== 'carousel') return;
    if (!this.scrollFrame) this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.target === null && this.viewport.clientWidth) this.paint(Math.round(this.viewport.scrollLeft / this.viewport.clientWidth));
    });
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.target = null;
      if (this.viewport.clientWidth) this.paint(Math.round(this.viewport.scrollLeft / this.viewport.clientWidth));
    }, 140);
  };
  private show(index: number, animate = true) {
    this.paint(index);
    if (this.node.attrs.layout !== 'carousel') { this.target = null; this.viewport.scrollLeft = 0; return; }
    this.target = this.active;
    const left = this.active * this.viewport.clientWidth;
    const reduce = this.dom.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.viewport.scrollTo) this.viewport.scrollTo({ left, behavior: animate && !reduce ? 'smooth' : 'auto' });
    else this.viewport.scrollLeft = left;
  }
  private paint(index: number) {
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
    this.prepareAdjacentImages();
  }
  private prepareAdjacentImages() {
    const next = new Set<HTMLElement>();
    if (this.inViewport && this.node.attrs.layout === 'carousel') for (let at = Math.max(0, this.active - 1); at <= Math.min(this.node.childCount - 1, this.active + 1); at++) {
      const slot = this.contentDOM.children.item(at); if (slot instanceof HTMLElement) next.add(slot);
    }
    for (const slot of this.nearby) if (!next.has(slot)) { slot.removeAttribute('data-carousel-nearby'); slot.dispatchEvent(new Event('nb-carousel-proximity')); }
    for (const slot of next) if (!this.nearby.has(slot)) { slot.setAttribute('data-carousel-nearby', ''); slot.dispatchEvent(new Event('nb-carousel-proximity')); }
    this.nearby = next;
  }
  update(node: Node, decorations: readonly Decoration[]) { if (node.type !== this.node.type) return false; const changed = this.node.attrs.layout !== node.attrs.layout || this.node.attrs.columns !== node.attrs.columns || this.node.attrs.width !== node.attrs.width || this.node.attrs.align !== node.attrs.align || this.node.childCount !== node.childCount; this.node = node; updateAnnotationMarker(this.annotation, annotationMarkerId(decorations)); if (changed) this.refresh(); return true; }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.type === 'attributes' && (mutation.target === this.dom || mutation.target === this.contentDOM || mutation.target === this.viewport) || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return this.footer.contains(event.target as globalThis.Node) || this.annotation.contains(event.target as globalThis.Node); }
  destroy() { this.stopViewport(); cancelAnimationFrame(this.frame); cancelAnimationFrame(this.scrollFrame); clearTimeout(this.settleTimer); this.resize?.disconnect(); this.viewport.removeEventListener('scroll', this.onScroll); this.viewport.removeEventListener('wheel', this.onWheel); this.viewport.removeEventListener('pointerdown', this.onPointerDown); }
}
class SlotView implements NodeView {
  dom = document.createElement('figure'); contentDOM = document.createElement('div');
  private add: HTMLButtonElement;
  private caption: HTMLButtonElement;
  constructor(private node: Node, editor: Editor, getPos: () => number | undefined, docKey: string) {
    this.dom.className = 'nb-image-slot'; this.contentDOM.className = 'nb-image-slot-content'; this.dom.dataset.nbImageSlot = ''; this.dom.dataset.imageSlot = '';
    this.add = button('添加图片', 'nb-image-slot-empty', () => { const pos = getPos(); if (pos !== undefined) void insertLocalImageWithDialog(editor, docKey, pos + 1); },
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg><span>添加图片</span>');
    this.caption = button('添加图注', 'nb-image-caption-add nb-caption-add', () => {
      const pos = getPos(); if (pos === undefined) return;
      const at = pos + this.node.nodeSize - 1, tr = editor.state.tr.insert(at, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, at + 1)); dispatchDiscreteEdit(editor.view, tr); editor.view.focus();
    });
    this.dom.append(this.add, this.contentDOM, this.caption); this.update(node);
  }
  update(node: Node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const empty = node.firstChild?.type.name !== 'image', paragraph = node.lastChild?.type.name === 'paragraph' ? node.lastChild : null;
    this.add.hidden = !empty; this.caption.hidden = empty || !!paragraph;
    this.dom.dataset.empty = String(empty);
    this.dom.dataset.captionEmpty = String(!empty && !!paragraph && !paragraph.content.size);
    return true;
  }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.target === this.dom || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return this.add.contains(event.target as globalThis.Node) || this.caption.contains(event.target as globalThis.Node); }
}
class DisclosureView implements NodeView {
  dom = document.createElement('section'); contentDOM = document.createElement('div');
  private title = document.createElement('input'); private toggle: HTMLButtonElement; private open: boolean;
  private annotation: HTMLSpanElement;
  private tail: HTMLButtonElement;
  constructor(private node: Node, private editor: Editor, private getPos: () => number | undefined, decorations: readonly Decoration[]) {
    this.dom.className = 'nb-disclosure'; this.contentDOM.className = 'nb-disclosure-body'; this.open = node.attrs.open;
    const header = document.createElement('div'); header.className = 'nb-disclosure-header'; header.contentEditable = 'false';
    this.toggle = button('收起内容', 'nb-disclosure-toggle', () => { this.open = !this.open; this.paint(); });
    this.toggle.replaceChildren(createDisclosureTriangle(this.dom.ownerDocument));
    this.title.className = 'nb-disclosure-title'; this.title.value = node.attrs.title; this.title.placeholder = '标题'; this.title.setAttribute('aria-label', '折叠块标题');
    this.title.onblur = () => this.commit();
    this.title.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.commit(); this.editor.commands.focus(); } else if (event.key === 'Escape') { this.title.value = this.node.attrs.title; this.title.blur(); this.editor.commands.focus(); } };
    this.annotation = createAnnotationMarker(annotationMarkerId(decorations), 'toolbar');
    this.tail = button('在折叠块末尾继续输入', 'nb-disclosure-tail', () => this.continueWriting()); this.tail.textContent = '';
    this.contentDOM.addEventListener('keydown', this.onTailKeyDown);
    header.append(this.toggle, this.title, this.annotation); this.dom.append(header, this.contentDOM, this.tail); this.paint();
  }
  private continueWriting() {
    continueContainerWriting(this.editor, this.getPos());
  }
  private onTailKeyDown = (event: KeyboardEvent) => {
    handleContainerTailKey(this.editor, this.getPos(), event);
  };
  private commit() {
    const pos = this.getPos(), title = this.title.value.trim(); if (pos === undefined || title === this.node.attrs.title) return;
    dispatchDiscreteEdit(this.editor.view, this.editor.state.tr.setNodeAttribute(pos, 'title', title));
  }
  private paint() { this.contentDOM.hidden = !this.open; this.tail.hidden = !this.open || !needsContainerTail(this.node) || !this.editor.isEditable; this.dom.dataset.open = String(this.open); this.toggle.setAttribute('aria-expanded', String(this.open)); const label = this.open ? '收起内容' : '展开内容'; this.toggle.title = label; this.toggle.setAttribute('aria-label', label); }
  update(node: Node, decorations: readonly Decoration[]) { if (node.type !== this.node.type) return false; if (node.attrs.title !== this.node.attrs.title) this.title.value = node.attrs.title; if (node.attrs.open !== this.node.attrs.open) this.open = node.attrs.open; this.node = node; updateAnnotationMarker(this.annotation, annotationMarkerId(decorations)); this.paint(); return true; }
  ignoreMutation(mutation: ViewMutationRecord) { return mutation.type !== 'selection' && (mutation.type === 'attributes' && (mutation.target === this.dom || mutation.target === this.contentDOM) || !this.contentDOM.contains(mutation.target)); }
  stopEvent(event: Event) { return !this.contentDOM.contains(event.target as globalThis.Node); }
  destroy() { this.contentDOM.removeEventListener('keydown', this.onTailKeyDown); }
}
export const InteractiveImageCollection = ImageCollection.extend({ addOptions() { return { ...this.parent?.(), ownsAnnotationMarker: true }; }, addNodeView() { return ({ node, editor, getPos, decorations }) => new CollectionView(node, editor, getPos, decorations); } });
export const InteractiveImageSlot = ImageSlot.extend<{ docKey: string }>({ addOptions() { return { docKey: '' }; }, addNodeView() { return ({ node, editor, getPos }) => new SlotView(node, editor, getPos, this.options.docKey); } });
export const InteractiveDisclosure = Disclosure.extend({ addOptions() { return { ...this.parent?.(), ownsAnnotationMarker: true }; }, addNodeView() { return ({ node, editor, getPos, decorations }) => new DisclosureView(node, editor, getPos, decorations); } });
