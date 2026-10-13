import { Extension } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { Fragment, type Node, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, Selection, TextSelection } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { dispatchDiscreteEdit } from './discreteEdit';
import { EDITOR_DRAG_ACTIVITY, isEditorDragging } from './editorDragActivity';
import { blockControlAnchor } from './blockVisualBounds';
import { contentViewport } from '../../core/dom/contentViewport';
import './blockBoundary.css';

const hidden = new Set(['annotationStore', 'documentPresentation']);
const scopes = new Set(['doc', 'annotationBody', 'disclosure', 'githubAlert', 'blockquote', 'listItem', 'taskItem']);
const activity = new WeakMap<EditorView, boolean>();
const activityEvent = 'nb-block-boundary-activity';
export function setBlockBoundaryActive(view: EditorView, active: boolean): void {
  activity.set(view, active); view.dom.dispatchEvent(new Event(activityEvent));
}
function available(view: EditorView): boolean {
  return view.editable && !view.isDestroyed && activity.get(view) !== false && view.dom.isConnected
    && !view.dom.closest('[inert]') && view.dom.ownerDocument.defaultView?.getComputedStyle(view.dom).visibility !== 'hidden';
}
function structural(node: Node | null): boolean {
  return !!node && node.isBlock && !hidden.has(node.type.name)
    && (!node.isTextblock || node.type.name === 'codeBlock');
}
function writing(node: Node | null): boolean { return !!node && node.isTextblock && node.type.name !== 'codeBlock'; }

/** A real block slot, never a position in text, table rows/cells or image captions. */
export function isBlockBoundary(at: ResolvedPos): boolean {
  if (!scopes.has(at.parent.type.name) || at.textOffset || at.parent.inlineContent) return false;
  const before = at.nodeBefore, after = at.nodeAfter;
  if (writing(before) || writing(after) || !structural(before) && !structural(after)) return false;
  const paragraph = at.doc.type.schema.nodes.paragraph;
  if (!paragraph) return false;
  // The shared block scopes have a repeating block grammar. Avoid walking every
  // previous sibling through contentMatchAt() on each pointer frame in long notes.
  if (paragraph.isInGroup('block') && (['block+', 'block*'].includes(at.parent.type.spec.content ?? '')
    || at.parent.type.spec.content === 'paragraph block*' && at.index() > 0)) return true;
  return at.parent.canReplace(at.index(), at.index(), Fragment.from(paragraph.create()));
}

/** Keep the upstream gap cursor's DOM/IME semantics, with schema-aware rich-block slots. */
export class BlockBoundarySelection extends GapCursor {
  map(doc: Node, mapping: Mappable): Selection {
    const at = doc.resolve(mapping.map(this.head));
    return isBlockBoundary(at) ? new BlockBoundarySelection(at) : Selection.near(at);
  }
  toJSON() { return { type: 'nbBlockBoundary', pos: this.head }; }
  static fromJSON(doc: Node, json: { pos: number }) {
    if (!Number.isInteger(json.pos)) throw new RangeError('Invalid block boundary position');
    return new BlockBoundarySelection(doc.resolve(json.pos));
  }
  getBookmark() { return new BoundaryBookmark(this.head); }
}
class BoundaryBookmark {
  constructor(readonly pos: number) {}
  map(mapping: Mappable) { return new BoundaryBookmark(mapping.map(this.pos)); }
  resolve(doc: Node): Selection {
    const at = doc.resolve(Math.min(this.pos, doc.content.size));
    return isBlockBoundary(at) ? new BlockBoundarySelection(at) : Selection.near(at);
  }
}
Selection.jsonID('nbBlockBoundary', BlockBoundarySelection);

export function insertBoundaryParagraph(view: EditorView, pos = view.state.selection.from, text = ''): boolean {
  if (!available(view) || !isBlockBoundary(view.state.doc.resolve(pos))) return false;
  const { state } = view, paragraph = state.schema.nodes.paragraph.create(null, text ? state.schema.text(text) : null);
  const at = state.doc.resolve(pos);
  if (!at.parent.canReplace(at.index(), at.index(), Fragment.from(paragraph))) return false;
  const tr = state.tr.insert(pos, paragraph);
  // Resolve against the inserted document; a boundary is not itself a text position.
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length));
  dispatchDiscreteEdit(view, tr.scrollIntoView()); view.focus(); return true;
}

function outerBoundary(at: ResolvedPos, direction: -1 | 1): number | null {
  if (!at.parent.isTextblock || at.parentOffset !== (direction < 0 ? 0 : at.parent.content.size)) return null;
  for (let depth = at.depth; depth > 0; depth--) {
    const pos = direction < 0 ? at.before(depth) : at.after(depth);
    if (isBlockBoundary(at.doc.resolve(pos))) return pos;
    // Only the first/last child may leave its container. Interior cells stay in the table.
    if (direction < 0 ? at.index(depth - 1) !== 0 : at.indexAfter(depth - 1) !== at.node(depth - 1).childCount) return null;
  }
  return null;
}
export function handleBlockBoundaryKey(view: EditorView, event: KeyboardEvent): boolean {
  if (!available(view) || view.composing || event.isComposing || event.defaultPrevented
    || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const { state } = view, selection = state.selection;
  const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
  const direction: -1 | 1 = ['ArrowLeft', 'ArrowUp', 'Backspace'].includes(event.key) ? -1 : 1;
  if (selection instanceof BlockBoundarySelection) {
    if (event.key === 'Enter') return insertBoundaryParagraph(view);
    if (arrow || event.key === 'Backspace' || event.key === 'Delete') {
      const at = selection.$from, node = direction < 0 ? at.nodeBefore : at.nodeAfter;
      if (!node || hidden.has(node.type.name)) return true;
      const next = event.key === 'Backspace' || event.key === 'Delete'
        ? NodeSelection.isSelectable(node) ? NodeSelection.create(state.doc, direction < 0 ? at.pos - node.nodeSize : at.pos) : Selection.near(at, direction)
        : Selection.near(state.doc.resolve(at.pos + direction), direction);
      view.dispatch(state.tr.setSelection(next).scrollIntoView()); return true;
    }
    return false;
  }
  if (selection instanceof TextSelection && selection.empty && event.key === 'Backspace'
    && selection.$from.parent.type.name === 'paragraph' && !selection.$from.parent.content.size) {
    const from = selection.$from.before(), to = selection.$from.after(), tr = state.tr.delete(from, to);
    if (isBlockBoundary(tr.doc.resolve(from))) {
      tr.setSelection(new BlockBoundarySelection(tr.doc.resolve(from)));
      dispatchDiscreteEdit(view, tr.scrollIntoView()); return true;
    }
  }
  let pos: number | null = null;
  if (selection instanceof NodeSelection && structural(selection.node)) {
    // Horizontal arrows in a carousel change its active slide.
    if (selection.node.type.name === 'imageCollection' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return false;
    if (arrow || event.key === 'Enter') pos = direction < 0 ? selection.from : selection.to;
  } else if (arrow && selection instanceof TextSelection && selection.empty) {
    const axis = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : direction < 0 ? 'left' : 'right';
    if (!view.endOfTextblock(axis)) return false;
    pos = outerBoundary(selection.$head, direction);
  }
  if (pos === null || !isBlockBoundary(state.doc.resolve(pos))) return false;
  if (event.key === 'Enter') return insertBoundaryParagraph(view, pos);
  view.dispatch(state.tr.setSelection(new BlockBoundarySelection(state.doc.resolve(pos))).scrollIntoView()); return true;
}

interface BoundaryTarget { pos: number; left: number; right: number; top: number; controlLeft: number }
function element(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos); return dom instanceof HTMLElement ? dom : null;
}
/** Hit only actual whitespace. A cell, code line, resize border or drag selection owns its interior. */
export function blockBoundaryAtPoint(view: EditorView, x: number, y: number, target: EventTarget | null): BoundaryTarget | null {
  if (!available(view) || view.composing || isEditorDragging(view) || !(target instanceof HTMLElement)
    || target.closest('.ProseMirror') !== view.dom || target.closest('input, textarea, button, [contenteditable="false"]')) return null;
  const hit = view.posAtCoords({ left: x, top: y }); if (!hit) return null;
  const at = view.state.doc.resolve(hit.pos), candidates = new Set<number>();
  for (let depth = at.depth; depth > 0; depth--) { candidates.add(at.before(depth)); candidates.add(at.after(depth)); }
  if (!at.depth) candidates.add(at.pos);
  for (const pos of candidates) {
    const boundary = view.state.doc.resolve(pos); if (!isBlockBoundary(boundary)) continue;
    const before = boundary.nodeBefore, after = boundary.nodeAfter;
    const previous = before && !hidden.has(before.type.name) ? element(view, pos - before.nodeSize) : null;
    const next = after && !hidden.has(after.type.name) ? element(view, pos) : null;
    const previousBox = previous?.getBoundingClientRect(), nextBox = next?.getBoundingClientRect();
    const parentBox = (boundary.depth ? element(view, boundary.before()) : view.dom)?.getBoundingClientRect();
    if (!parentBox) continue;
    const top = previousBox?.bottom ?? Math.max(parentBox.top, (nextBox?.top ?? parentBox.top) - 24);
    const bottom = nextBox?.top ?? Math.min(parentBox.bottom, (previousBox?.bottom ?? parentBox.bottom) + 24);
    const left = Math.max(parentBox.left, nextBox?.left ?? previousBox?.left ?? parentBox.left);
    const right = Math.min(parentBox.right, nextBox?.right ?? previousBox?.right ?? parentBox.right);
    if (bottom <= top || y < top || y > bottom || x < left || x > right) continue;
    const anchor = next ?? previous, node = next ? after : before;
    const anchorWidth = anchor?.getBoundingClientRect().width ?? 0;
    const controlLeft = anchor && node ? blockControlAnchor(anchor, node.type.name, anchorWidth / (anchor.offsetWidth || anchorWidth || 1)).left : left;
    return { pos, left, right, top: (top + bottom) / 2, controlLeft };
  }
  return null;
}

export function createBlockBoundaryPlugin(): Plugin {
  let hover: BoundaryTarget | null = null, press: { x: number; y: number; pos: number } | null = null, acceptedClick = false;
  let show: (target: BoundaryTarget | null) => void = () => {};
  return new Plugin({
    props: {
      createSelectionBetween(_view, anchor, head) {
        return anchor.pos === head.pos && isBlockBoundary(head) ? new BlockBoundarySelection(head) : null;
      },
      handleKeyDown: handleBlockBoundaryKey,
      handleClick() { const accepted = acceptedClick; acceptedClick = false; return accepted; },
      handleTextInput(view, _from, _to, text) { return view.state.selection instanceof BlockBoundarySelection && insertBoundaryParagraph(view, undefined, text); },
      handleDOMEvents: {
        beforeinput(view, event) {
          if (event.inputType === 'insertCompositionText' && view.state.selection instanceof BlockBoundarySelection) insertBoundaryParagraph(view);
          return false;
        },
        mousemove(view, event) {
          if (event.buttons) { show(null); return false; }
          show(blockBoundaryAtPoint(view, event.clientX, event.clientY, event.target)); return false;
        },
        mouseleave(_view, event) { if (!(event.relatedTarget instanceof HTMLElement) || !event.relatedTarget.closest('.nb-block-boundary-insert')) show(null); return false; },
        mousedown(view, event) {
          press = null; acceptedClick = false;
          if (event.button || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
          const target = blockBoundaryAtPoint(view, event.clientX, event.clientY, event.target);
          if (target) press = { x: event.clientX, y: event.clientY, pos: target.pos };
          return false;
        },
        mouseup(view, event) {
          const down = press; press = null;
          if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || isEditorDragging(view)) return false;
          const target = blockBoundaryAtPoint(view, event.clientX, event.clientY, event.target);
          if (!target || target.pos !== down.pos) return false;
          view.dispatch(view.state.tr.setSelection(new BlockBoundarySelection(view.state.doc.resolve(target.pos))));
          acceptedClick = true; view.focus(); event.preventDefault(); return true;
        },
      },
    },
    view(view) {
      const button = view.dom.ownerDocument.createElement('button');
      button.className = 'nb-block-boundary-insert'; button.type = 'button';
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      button.title = '插入段落'; button.setAttribute('aria-label', '在块之间插入段落'); button.hidden = true;
      view.dom.ownerDocument.body.append(button);
      show = target => {
        if (!available(view)) target = null;
        hover = target; button.hidden = !target;
        if (target) { button.style.left = `${Math.max(contentViewport(view.dom).outer.left + 19, target.controlLeft - 23)}px`; button.style.top = `${target.top}px`; }
      };
      const insert = (event: MouseEvent) => {
        if (event.button || !hover) return;
        event.preventDefault(); const pos = hover.pos; show(null); insertBoundaryParagraph(view, pos);
      };
      const clear = () => { press = null; show(null); };
      button.addEventListener('pointerdown', insert);
      button.addEventListener('click', event => { if (!event.detail) insert(event); });
      view.dom.addEventListener(EDITOR_DRAG_ACTIVITY, clear);
      view.dom.addEventListener(activityEvent, clear);
      view.dom.ownerDocument.addEventListener('scroll', clear, true);
      view.dom.ownerDocument.defaultView?.addEventListener('blur', clear);
      return {
        update(_view, previous) { if (hover && (previous.doc !== view.state.doc || !view.editable)) clear(); },
        destroy() { activity.delete(view); button.remove(); show = () => {}; view.dom.removeEventListener(activityEvent, clear); view.dom.removeEventListener(EDITOR_DRAG_ACTIVITY, clear); view.dom.ownerDocument.removeEventListener('scroll', clear, true); view.dom.ownerDocument.defaultView?.removeEventListener('blur', clear); },
      };
    },
  });
}
export const BlockBoundary = Extension.create({ name: 'blockBoundary', priority: 1250, addProseMirrorPlugins: () => [createBlockBoundaryPlugin()] });
