import type { MarkType } from '@tiptap/pm/model';
import type { Command, EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { toggleMark } from '@tiptap/pm/commands';
import { documentColor } from '../../document-style/colors';
import { dispatchDiscreteEdit } from '../discreteEdit';
import { clearTextStyleMarks } from '../textStyleMarks';

export type MarkStatus = false | true | 'mixed';

/** Only inspect the draft selection; a caret never traverses the draft document. */
export function draftMarkStatus(state: EditorState, name: string): MarkStatus {
  const type = state.schema.marks[name];
  if (!type) return false;
  if (state.selection.empty) return !!type.isInSet(state.storedMarks ?? state.selection.$from.marks());
  let marked = false, unmarked = false;
  for (const { $from, $to } of state.selection.ranges) state.doc.nodesBetween($from.pos, $to.pos, node => {
    if (marked && unmarked) return false;
    if (node.isInline && node.isText) {
      if (type.isInSet(node.marks)) marked = true; else unmarked = true;
    }
  });
  return marked ? unmarked ? 'mixed' : true : false;
}

export function draftMarkAttributes(state: EditorState, name: string): Record<string, unknown> {
  const type = state.schema.marks[name]; if (!type) return {};
  if (state.selection.empty) return type.isInSet(state.storedMarks ?? state.selection.$from.marks())?.attrs ?? {};
  let attrs: Record<string, unknown> | undefined;
  for (const { $from, $to } of state.selection.ranges) state.doc.nodesBetween($from.pos, $to.pos, node => {
    if (attrs) return false;
    if (node.isText) attrs = type.isInSet(node.marks)?.attrs;
  });
  return attrs ?? {};
}

export function runDraftCommand(view: EditorView, command: Command): boolean {
  if (view.isDestroyed || view.composing) return false;
  const changed = command(view.state, tr => dispatchDiscreteEdit(view, tr), view);
  if (changed) view.focus();
  return changed;
}

export function canStyleDraftMark(state: EditorState, name: string): boolean {
  const type = state.schema.marks[name];
  if (!type || !toggleMark(type)(state)) return false;
  const compatible = (marks: readonly import('@tiptap/pm/model').Mark[]) =>
    marks.every(mark => mark.type === type || !mark.type.excludes(type) || type.excludes(mark.type));
  if (state.selection.empty) return compatible(state.storedMarks ?? state.selection.$from.marks());
  let allowed = false;
  for (const { $from, $to } of state.selection.ranges) state.doc.nodesBetween($from.pos, $to.pos, (node, _pos, parent) => {
    if (allowed) return false;
    if (node.isText && parent?.type.allowsMarkType(type) && compatible(node.marks)) allowed = true;
  });
  return allowed;
}

function setSelectedMark(tr: Transaction, type: MarkType, attrs: Record<string, unknown> | null): void {
  if (tr.selection.empty) {
    if (attrs) tr.addStoredMark(type.create(attrs)); else tr.removeStoredMark(type);
  } else for (const { $from, $to } of tr.selection.ranges) {
    if (attrs) tr.addMark($from.pos, $to.pos, type.create(attrs)); else tr.removeMark($from.pos, $to.pos, type);
  }
}

export function setDraftColor(view: EditorView, name: 'textColor' | 'highlight', color: string | null): boolean {
  if (color !== null && !documentColor(color)) return false;
  return runDraftCommand(view, (state, dispatch) => {
    if (!canStyleDraftMark(state, name)) return false;
    const tr = state.tr; setSelectedMark(tr, state.schema.marks[name], color ? { color: documentColor(color) } : null);
    dispatch?.(tr); return true;
  });
}

/** Match the main editor's clear-text policy: links and semantic marks survive. */
export const clearDraftTextFormatting: Command = (state, dispatch) => {
  const tr = state.tr;
  if (!clearTextStyleMarks(tr)) return false;
  dispatch?.(tr); return true;
};

export function validDraftLink(value: string): boolean {
  return !!value.trim() && !Array.from(value.trim()).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !/^(?:javascript|vbscript|data):/i.test(value.trim());
}

export function setDraftLink(view: EditorView, href: string | null): boolean {
  if (href !== null && !validDraftLink(href)) return false;
  return runDraftCommand(view, (state, dispatch) => {
    if (!canStyleDraftMark(state, 'link')) return false;
    // A caret can edit/remove an existing link; new links need visible selected text.
    const type = state.schema.marks.link, current = type.isInSet(state.storedMarks ?? state.selection.$from.marks());
    const tr = state.tr;
    if (state.selection.empty) {
      if (!current) return false;
      const parent = state.selection.$from.parent, start = state.selection.$from.start();
      let from = state.selection.from, to = from;
      parent.forEach((node, offset) => {
        const at = start + offset, end = at + node.nodeSize;
        if (end >= from && at <= to && current.isInSet(node.marks)) { from = Math.min(from, at); to = Math.max(to, end); }
      });
      // Extend left through adjacent fragments carrying this same link.
      const fragments: { from: number; to: number; linked: boolean }[] = [];
      parent.forEach((node, offset) => fragments.push({ from: start + offset, to: start + offset + node.nodeSize, linked: !!current.isInSet(node.marks) }));
      for (let index = fragments.length - 1; index >= 0; index--) {
        const fragment = fragments[index]; if (fragment.linked && fragment.to === from) from = fragment.from;
      }
      tr.removeMark(from, to, type); if (href) tr.addMark(from, to, type.create({ ...current.attrs, href: href.trim() }));
      if (href) tr.addStoredMark(type.create({ ...current.attrs, href: href.trim() })); else tr.removeStoredMark(type);
    } else setSelectedMark(tr, type, href ? { href: href.trim() } : null);
    dispatch?.(tr); return true;
  });
}
