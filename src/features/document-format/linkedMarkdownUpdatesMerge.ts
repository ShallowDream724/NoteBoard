import type { NativeNode } from '../../core/nativeDocument';

export interface LinkedTextPatch { nativePath: number[]; projectionPath: number[]; start: number; end: number; text: string }
export interface LinkedMergeConflict {
  kind: 'conflict'; reason: 'structure' | 'overlap' | 'ambiguous-style' | 'projection'; message: string; path: number[];
}
export type LinkedMergeResult = LinkedMergeConflict | { kind: 'merged' | 'unchanged'; document: NativeNode; patches: LinkedTextPatch[]; changedBlocks: number };
interface Edit { start: number; end: number; text: string }
const textBlocks = new Set(['paragraph', 'heading', 'codeBlock']);
const hidden = new Set(['documentPresentation', 'annotationStore']);

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
function shell(node: NativeNode): Record<string, unknown> { const { content: _content, text: _text, ...rest } = node; return rest; }
function textOf(node: NativeNode): string { return (node.content ?? []).map(child => child.text ?? '').join(''); }
function isTextBlock(node: NativeNode): boolean { return textBlocks.has(node.type ?? '') && (node.content ?? []).every(child => child.type === 'text' && typeof child.text === 'string'); }
function isLow(value: number): boolean { return value >= 0xdc00 && value <= 0xdfff; }

/** A single conservative edit range per block, with Unicode-safe boundaries. */
export function linkedTextEdit(before: string, after: string): Edit | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (isLow(before.charCodeAt(start)) || isLow(after.charCodeAt(start))) start--;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before.charCodeAt(before.length - tail - 1) === after.charCodeAt(after.length - tail - 1)) tail++;
  if (isLow(before.charCodeAt(before.length - tail)) || isLow(after.charCodeAt(after.length - tail))) tail--;
  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}
function style(node: NativeNode): Record<string, unknown> { const { text: _text, ...rest } = node; return rest; }
function marks(node: NativeNode): { end: number; marks: unknown[] }[] {
  const result: { end: number; marks: unknown[] }[] = [];
  let end = 0;
  for (const child of node.content ?? []) {
    const mark = child.marks ?? []; end += child.text?.length ?? 0;
    if (result.length && equal(result[result.length - 1].marks, mark)) result[result.length - 1].end = end;
    else result.push({ end, marks: mark });
  }
  return result;
}
function conflict(reason: LinkedMergeConflict['reason'], path: number[], message: string): LinkedMergeConflict { return { kind: 'conflict', reason, path, message }; }

/** Keep untouched run objects and their marks/attrs. An inserted span requires
 * one unambiguous existing style; we never guess across differently styled runs. */
function patchBlock(node: NativeNode, edit: Edit, path: number[]): NativeNode | LinkedMergeConflict {
  const runs = node.content ?? [], affected: NativeNode[] = [];
  let offset = 0;
  for (const run of runs) {
    const end = offset + (run.text?.length ?? 0);
    if (edit.start === edit.end ? offset <= edit.start && end >= edit.start : offset < edit.end && end > edit.start) affected.push(run);
    offset = end;
  }
  if (edit.text && affected.length > 1 && affected.some(run => !equal(style(run), style(affected[0])))) {
    return conflict('ambiguous-style', path, '外部文字修改跨越不同样式，无法确定新文字的格式。');
  }
  const template = affected[0] ?? { type: 'text' };
  const output: NativeNode[] = [];
  let inserted = false;
  const insert = () => { if (!inserted) { if (edit.text) output.push({ ...template, text: edit.text }); inserted = true; } };
  offset = 0;
  for (const run of runs) {
    const text = run.text ?? '', end = offset + text.length;
    if (end <= edit.start) output.push(run);
    else if (offset >= edit.end) { insert(); output.push(run); }
    else {
      if (offset < edit.start) output.push({ ...run, text: text.slice(0, edit.start - offset) });
      insert();
      if (end > edit.end) output.push({ ...run, text: text.slice(edit.end - offset) });
    }
    offset = end;
  }
  insert();
  return { ...node, content: output };
}
function isConflict(value: NativeNode | LinkedMergeConflict): value is LinkedMergeConflict { return value.kind === 'conflict'; }
function children(node: NativeNode): { node: NativeNode; index: number }[] {
  return (node.content ?? []).map((child, index) => ({ node: child, index })).filter(child => node.type !== 'doc' || !hidden.has(child.node.type ?? ''));
}

/** Replay sparse accepted remote edits in one tree walk, without retaining a
 * second full document in session state or cloning a root once per text block. */
function replay(tree: NativeNode, patches: LinkedTextPatch[], projection: boolean): NativeNode | LinkedMergeConflict {
  const byPath = new Map(patches.map(patch => [(projection ? patch.projectionPath : patch.nativePath).join('.'), patch]));
  const visit = (node: NativeNode, path: number[]): NativeNode | LinkedMergeConflict => {
    const patch = byPath.get(path.join('.'));
    if (patch) return patchBlock(node, patch, path);
    if (!node.content) return node;
    let changed = false;
    const content: NativeNode[] = [];
    for (let index = 0; index < node.content.length; index++) {
      const child = visit(node.content[index], [...path, index]);
      if (isConflict(child)) return child;
      changed ||= child !== node.content[index]; content.push(child);
    }
    return changed ? { ...node, content } : node;
  };
  return patches.length ? visit(tree, []) : tree;
}

/** Position/structure correspondence only. Each text block uses prefix/suffix
 * edits, so repeated text elsewhere cannot steal a match and work stays linear. */
export function mergeLinkedMarkdownTrees(original: NativeNode, local: NativeNode, originalProjection: NativeNode, external: NativeNode, accepted: LinkedTextPatch[] = []): LinkedMergeResult {
  const baseline = replay(original, accepted, false), projection = replay(originalProjection, accepted, true);
  if (isConflict(baseline)) return baseline;
  if (isConflict(projection)) return projection;
  let changedBlocks = 0;
  const patches: LinkedTextPatch[] = [];
  const visit = (base: NativeNode, current: NativeNode, projected: NativeNode, remote: NativeNode, oldProjection: NativeNode, path: number[], projectionPath: number[]): NativeNode | LinkedMergeConflict => {
    if (projected.type !== remote.type || !equal(shell(projected), shell(remote))) return conflict('structure', path, '关联 Markdown 的结构或语义格式已变化，需要手动处理。');
    if (base.type !== projected.type || current.type !== base.type) {
      return equal(projected, remote) ? current : conflict('projection', path, '该内容的 Markdown 表达与原生结构不能一一对应。');
    }
    if (isTextBlock(base) && isTextBlock(projected) && isTextBlock(remote) && isTextBlock(current)) {
      const originalRemoteEdit = linkedTextEdit(textOf(oldProjection), textOf(remote));
      if (originalRemoteEdit) patches.push({ ...originalRemoteEdit, nativePath: path, projectionPath });
      const before = textOf(base), projectedText = textOf(projected), externalText = textOf(remote), localText = textOf(current);
      const remoteEdit = linkedTextEdit(projectedText, externalText);
      const predicted = remoteEdit ? patchBlock(projected, remoteEdit, path) : projected;
      if (isConflict(predicted) || !equal(marks(predicted), marks(remote))) return conflict('structure', path, '外部 Markdown 改变了文字格式，需要确认后处理。');
      if (!remoteEdit) return current;
      if (before !== projectedText) return conflict('projection', path, '该段落投影后的文字与原文不同，无法安全映射外部修改。');
      if (localText === externalText) return current;
      const localEdit = linkedTextEdit(before, localText);
      let edit = remoteEdit;
      if (localEdit) {
        // Touching insertion boundaries are ambiguous; independent, disjoint
        // replacements are safe and map by the local edit's length delta.
        const left = localEdit.end < edit.start || (localEdit.end === edit.start && localEdit.start < localEdit.end && edit.start < edit.end);
        const right = edit.end < localEdit.start || (edit.end === localEdit.start && edit.start < edit.end && localEdit.start < localEdit.end);
        if (!left && !right) return conflict('overlap', path, '当前文档与外部 Markdown 修改了同一段文字，已保留当前内容。');
        if (left) { const delta = localEdit.text.length - (localEdit.end - localEdit.start); edit = { ...edit, start: edit.start + delta, end: edit.end + delta }; }
      }
      const updated = patchBlock(current, edit, path);
      if (!isConflict(updated)) changedBlocks++;
      return updated;
    }
    const baseChildren = children(base), localChildren = children(current), projectedChildren = children(projected), remoteChildren = children(remote), oldChildren = children(oldProjection);
    if (!projectedChildren.length && !remoteChildren.length) return equal(projected, remote) ? current : conflict('structure', path, '外部修改涉及不能安全还原的内容。');
    if ([baseChildren.length, localChildren.length, remoteChildren.length, oldChildren.length].some(length => length !== projectedChildren.length)) return conflict('structure', path, '段落、列表或表格结构已变化，无法逐块对应。');
    // An exact paragraph move is a structural ambiguity, not a text replacement
    // that should inherit the old position's styling. This map only rejects such
    // cases; it is never used to relocate or fuzzily match document content.
    const positions = new Map<string, number[]>();
    projectedChildren.forEach(({ node }, index) => {
      if (isTextBlock(node)) { const text = textOf(node), indexes = positions.get(text) ?? []; indexes.push(index); positions.set(text, indexes); }
    });
    for (let index = 0; index < remoteChildren.length; index++) {
      const remoteChild = remoteChildren[index].node, projectedChild = projectedChildren[index].node;
      if (isTextBlock(remoteChild) && isTextBlock(projectedChild)) {
        const text = textOf(remoteChild);
        if (text !== textOf(projectedChild) && positions.get(text)?.some(position => position !== index)) return conflict('structure', path, '外部段落可能被移动，无法确定文字与原有样式的对应关系。');
      }
    }
    let changed = false;
    const content = [...(current.content ?? [])];
    for (let index = 0; index < projectedChildren.length; index++) {
      const next = visit(baseChildren[index].node, localChildren[index].node, projectedChildren[index].node, remoteChildren[index].node, oldChildren[index].node, [...path, baseChildren[index].index], [...projectionPath, projectedChildren[index].index]);
      if (isConflict(next)) return next;
      changed ||= next !== localChildren[index].node;
      content[localChildren[index].index] = next;
    }
    return changed ? { ...current, content } : current;
  };
  const document = visit(baseline, local, projection, external, originalProjection, [], []);
  return isConflict(document) ? document : { kind: changedBlocks ? 'merged' : 'unchanged', document, patches, changedBlocks };
}
