import { Extension } from '@tiptap/core';
import type { Mark, Node, Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep, ReplaceAroundStep, AddMarkStep } from '@tiptap/pm/transform';
import { editorDocumentFormat } from '../editor-md/editorDocumentCodec';
import { runWithDocumentCapability } from './featureGate';
import type { DocumentCapabilityId } from './capabilities';
import { showToast } from '../../stores/toastStore';
import { CellTextStyleStep } from '../document-style/cellTextStyle';

const guardKey = new PluginKey('documentCapabilityGuard');
type Feature = { capability: DocumentCapabilityId; signature: string };
const markCapabilities: Record<string, DocumentCapabilityId> = {
  textColor: 'textColor', highlight: 'highlight', textStyle: 'fontSize', fontSize: 'fontSize',
  conceal: 'conceal', annotationReference: 'annotation',
};
function markFeature(mark: Mark): Feature | null {
  const capability = markCapabilities[mark.type.name];
  return capability ? { capability, signature: `mark:${mark.type.name}:${JSON.stringify(mark.attrs)}` } : null;
}
function nodeFeatures(node: Node): Feature[] {
  const found: Feature[] = [];
  const add = (capability: DocumentCapabilityId, field: string, value: unknown) => found.push({ capability, signature: `${node.type.name}:${field}:${JSON.stringify(value)}` });
  const { attrs } = node, type = node.type.name;
  if (['imageCollection', 'imageSlot'].includes(type)) add('gallery', 'type', type);
  if (type === 'imageCollection') add('gallery', 'layout', [attrs.layout, attrs.columns]);
  if (type === 'disclosure') { add('disclosure', 'type', type); add('disclosure', 'presentation', [attrs.title, attrs.open]); }
  if (type === 'githubAlert' && [attrs.title, attrs.icon, attrs.textColor, attrs.borderColor, attrs.backgroundColor].some(value => value != null)) {
    add('callout', 'presentation', [attrs.title, attrs.icon, attrs.textColor, attrs.borderColor, attrs.backgroundColor]);
  }
  if (type.startsWith('annotation')) add('annotation', 'type', type);
  if (attrs.annotationId) add('annotation', 'annotationId', attrs.annotationId);
  if (attrs.concealed) add('conceal', 'concealed', true);
  if (attrs.textColor && type !== 'githubAlert') add('textColor', 'textColor', attrs.textColor);
  if (attrs.background) add(type === 'tableCell' || type === 'tableHeader' ? 'tableFill' : 'highlight', 'background', attrs.background);
  if (attrs.fontSize) add('fontSize', 'fontSize', attrs.fontSize);
  if (attrs.textAlign) add('alignment', 'textAlign', attrs.textAlign);
  if (attrs.indent) add('alignment', 'indent', attrs.indent);
  if (attrs.verticalAlign) add('alignment', 'verticalAlign', attrs.verticalAlign);
  if (type === 'table' && attrs.tableAlign) add('tableAlignment', 'tableAlign', attrs.tableAlign);
  if (['table', 'image'].includes(type) && attrs.caption) add('figureCaption', 'caption', attrs.caption);
  // A GFM column's horizontal alignment is portable. Arbitrary cell alignment
  // is gated by its command and the table presentation step below.
  if (Number(attrs.colspan) > 1 || Number(attrs.rowspan) > 1) add('tableMerge', 'span', [attrs.colspan, attrs.rowspan]);
  if (Array.isArray(attrs.colwidth) && attrs.colwidth.some(width => Number(width) > 0)) add('tableDimensions', 'colwidth', attrs.colwidth);
  if (type === 'tableRow' && Number(attrs.height) > 0) add('tableDimensions', 'height', attrs.height);
  if (type === 'image') {
    if (attrs.align && attrs.align !== node.type.spec.attrs?.align?.default) add('imageLayout', 'align', attrs.align);
    if (attrs.width && attrs.width !== node.type.spec.attrs?.width?.default || attrs.height) add('imageLayout', 'size', [attrs.width, attrs.height]);
  }
  if (type === 'documentPresentation' && attrs.tableStyle && attrs.tableStyle !== 'standard') add('tableStyle', 'tableStyle', attrs.tableStyle);
  for (const mark of node.marks) { const feature = markFeature(mark); if (feature) found.push(feature); }
  return found;
}
function features(fragment: Fragment): Feature[] {
  const found: Feature[] = [];
  fragment.descendants(node => { found.push(...nodeFeatures(node)); });
  return found;
}
/** Inspect only changed steps/fragments. Ordinary typing never scans the doc. */
export function transactionAddedCapability(tr: Transaction, storedMarks: readonly Mark[] | null = null): DocumentCapabilityId | null {
  if (tr.storedMarksSet && tr.storedMarks) {
    const inherited = storedMarks ?? tr.before.resolve(Math.min(tr.selection.from, tr.before.content.size)).marks();
    const signatures = new Set(inherited.flatMap(mark => { const feature = markFeature(mark); return feature ? [feature.signature] : []; }));
    for (const mark of tr.storedMarks) { const feature = markFeature(mark); if (feature && !signatures.has(feature.signature)) return feature.capability; }
  }
  for (let index = 0; index < tr.steps.length; index++) {
    const step = tr.steps[index], before = tr.docs[index];
    if (step instanceof CellTextStyleStep) {
      const added = step.patches.map(patch => ({ patch, features: features(patch.content) })).filter(value => value.features.length);
      if (!added.length) continue;
      const wanted = new Set(added.map(value => value.patch.pos)), previous = new Map<number, Set<string>>();
      before.nodeAt(step.pos)?.forEach((row, rowPos) => row.forEach((cell, cellPos) => {
        const pos = rowPos + 1 + cellPos;
        if (wanted.has(pos)) previous.set(pos, new Set(features(cell.content).map(feature => feature.signature)));
      }));
      for (const value of added) {
        const unsupported = value.features.find(feature => !previous.get(value.patch.pos)?.has(feature.signature));
        if (unsupported) return unsupported.capability;
      }
      continue;
    }
    if (step instanceof AddMarkStep) {
      const feature = markFeature(step.mark);
      if (feature) return feature.capability;
      continue;
    }
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      if (!step.slice.content.size) continue;
      if (step instanceof ReplaceAroundStep && before.nodeAt(step.from)?.type.name === 'tableCell' && step.slice.content.firstChild?.type.name === 'tableHeader') {
        const at = before.resolve(step.from);
        if (at.parent.type.name === 'tableRow' && at.depth > 0 && at.index(at.depth - 1) > 0) return 'tableHeader';
      }
      const added = features(step.slice.content);
      if (!added.length) continue;
      const previous = new Set(features(before.slice(step.from, step.to).content).map(feature => feature.signature));
      // Inherited marks remain valid when typing into an existing HTML span.
      if (step.from === step.to) for (const mark of before.resolve(step.from).marks()) {
        const feature = markFeature(mark); if (feature) previous.add(feature.signature);
      }
      // Node markup steps retain the existing node's content outside the slice.
      if (step instanceof ReplaceAroundStep) {
        const node = before.nodeAt(step.from);
        if (node) nodeFeatures(node).forEach(feature => previous.add(feature.signature));
      }
      const unsupported = added.find(feature => !previous.has(feature.signature));
      if (unsupported) return unsupported.capability;
      continue;
    }
    const value = step.toJSON() as { stepType: string; pos?: number; attr?: string; value?: unknown; patches?: Array<Record<string, unknown>> };
    if (value.stepType === 'noteboardTableColumnWidths' || value.stepType === 'noteboardTableRowHeights') return 'tableDimensions';
    if (value.stepType === 'noteboardTableAlignment' && value.value) return 'tableAlignment';
    if (value.stepType === 'noteboardBlockMetadata' && value.value) return value.attr === 'caption' ? 'figureCaption' : 'annotation';
    if (value.stepType === 'noteboardTablePresentation') {
      if (value.patches?.some(patch => patch.background)) return 'tableFill';
      if (value.patches?.some(patch => patch.textAlign || patch.verticalAlign)) return 'alignment';
      // Header-row controls are GFM-compatible and remain ordinary MD edits.
    }
    if (value.stepType === 'attr' && value.pos !== undefined && value.attr) {
      const old = before.nodeAt(value.pos), next = tr.doc.nodeAt(tr.mapping.slice(index + 1).map(value.pos));
      if (old && next) {
        const previous = new Set(nodeFeatures(old).map(feature => feature.signature));
        const added = nodeFeatures(next).find(feature => !previous.has(feature.signature));
        if (added) return added.capability;
      }
    }
  }
  return null;
}

/** Last line of defense for direct commands, keyboard shortcuts and resizing. */
export const DocumentCapabilityGuard = Extension.create({
  name: 'documentCapabilityGuard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ key: guardKey, filterTransaction(tr) {
      if (!tr.docChanged && !tr.storedMarksSet || editorDocumentFormat(editor) === 'noteboard'
        || tr.getMeta('noteboard-document-replacement') || tr.getMeta('history$') || tr.getMeta(guardKey)) return true;
      const capability = transactionAddedCapability(tr, editor.state.storedMarks);
      if (!capability) return true;
      const before = tr.before, selection = tr.selection.toJSON(), steps = tr.steps.slice();
      // Conversion must happen outside the dispatch currently being filtered.
      queueMicrotask(() => runWithDocumentCapability(editor, capability, next => {
        if (!next.state.doc.eq(before)) { showToast('内容已变化，请重新应用此操作', 'warning'); return false; }
        const replay = next.state.tr;
        for (const step of steps) if (replay.maybeStep(step).failed) return false;
        try { replay.setSelection(Selection.fromJSON(replay.doc, selection)); } catch { return false; }
        if (tr.storedMarksSet) replay.setStoredMarks(tr.storedMarks);
        next.view.dispatch(replay.setMeta(guardKey, true));
        return true;
      }));
      return false;
    } })];
  },
});
