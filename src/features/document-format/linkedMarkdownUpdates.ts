import * as ipc from '../../core/ipc/commands';
import { readNativeMetadata, replaceNativeMetadata } from '../../core/nativeDocument';
import { on, off } from '../../core/emitter';
import { documentTextHash } from '../../core/nativeDocumentIO';
import { getDocumentRevision, getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore, type Document } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { flushDocument, getSessionGeneration } from '../session/documentSession';
import { prepareTextExport } from '../export/documentConversion';
import { sameKey } from '../explorer/pathUtils';
import { markdownLinkPath, nativeMarkdownLink, parentDirectory, MARKDOWN_PROJECTION_VERSION } from './nativeLink';
import type { LinkedTextPatch, LinkedMergeConflict } from './linkedMarkdownUpdatesMerge';
import { prepareLinkedMarkdownMerge } from './linkedMarkdownUpdatesWorkerClient';

export interface LinkedMarkdownConflict {
  nativeKey: string;
  markdownPath: string;
  reason: LinkedMergeConflict['reason'] | 'unreadable' | 'busy' | 'invalid-native';
  message: string;
  externalHash?: string;
  blockPath?: number[];
}
interface Acceptance { generation: number; path: string; baseline: string | null; hash: string; patches: LinkedTextPatch[]; explicit?: boolean }
const accepted = new Map<string, Acceptance>();
const conflicts = new Map<string, LinkedMarkdownConflict>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
const rerun = new Set<string>();
const controllers = new Map<string, AbortController>();
// Queue keys and lifecycle tokens only. Full snapshots are captured after a
// slot opens, bounding both active converter workers and transient document data.
const pending = new Map<string, { generation: number; finish: () => void }>();
const MAX_ACTIVE_CHECKS = 2;
let activeChecks = 0;

function publish(key: string, conflict?: LinkedMarkdownConflict): void {
  const previous = conflicts.get(key);
  if (conflict) conflicts.set(key, conflict); else conflicts.delete(key);
  if (previous || conflict) for (const listener of listeners) listener();
}
export function subscribeLinkedMarkdownConflicts(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getLinkedMarkdownConflict(nativeKey: string): LinkedMarkdownConflict | undefined { return conflicts.get(nativeKey); }
export function getLinkedMarkdownConflicts(): LinkedMarkdownConflict[] { return [...conflicts.values()]; }

function acceptance(doc: Document, path: string): Acceptance | undefined {
  const receipt = accepted.get(doc.key);
  if (receipt && receipt.generation === getSessionGeneration(doc.key) && sameKey(receipt.path, path) && receipt.baseline === doc.baselineContent) return receipt;
  accepted.delete(doc.key);
  return undefined;
}
/** A confirmed Markdown version never changes the NB disk baseline/CAS hash. */
export function getAcceptedLinkedMarkdownHash(nativeKey: string, markdownPath: string, source?: string): string | undefined {
  const doc = useDocumentStore.getState().getDocument(nativeKey);
  const link = doc && nativeMarkdownLink(nativeKey, doc.content);
  if (!doc || !link || !sameKey(link.path, markdownPath)) return undefined;
  const receipt = acceptance(doc, markdownPath);
  return receipt && (receipt.explicit || readNativeMetadata(source ?? doc.content ?? '').markdown?.baselineHash === receipt.hash) ? receipt.hash : undefined;
}

export function clearLinkedMarkdownSession(key: string): void {
  controllers.get(key)?.abort(); controllers.delete(key);
  const queued = pending.get(key);
  if (queued) { pending.delete(key); running.delete(key); queued.finish(); }
  accepted.delete(key); publish(key); rerun.delete(key);
  const timer = timers.get(key); if (timer) clearTimeout(timer); timers.delete(key);
}
/** Optional lifecycle cleanup only. Open/save/watch indexing is owned by the
 * shell's nativeDocumentLifecycle, with no subscription to editor body changes. */
export function startLinkedMarkdownUpdates(): () => void {
  const remove = ({ key }: { key: string }) => clearLinkedMarkdownSession(key);
  on('document-session-ended', remove);
  return () => { off('document-session-ended', remove); for (const key of new Set([...timers.keys(), ...accepted.keys(), ...controllers.keys(), ...pending.keys(), ...conflicts.keys()])) clearLinkedMarkdownSession(key); };
}

function scheduleNativeCheck(key: string): void {
  const prior = timers.get(key); if (prior) clearTimeout(prior);
  timers.set(key, setTimeout(() => { timers.delete(key); void checkLinkedMarkdownUpdates(key); }, 120));
}
/** Directory watcher paths are matched against open NB links, not just MD tabs. */
export function scheduleLinkedMarkdownCheck(path: string, nativeKeys?: Iterable<string>): void {
  const documents = useDocumentStore.getState().documents;
  for (const key of nativeKeys ?? documents.keys()) {
    const doc = documents.get(key); if (!doc) continue;
    if (doc.kind !== 'noteboard') continue;
    const link = nativeMarkdownLink(doc.key, doc.content);
    if (link && sameKey(link.path, path)) scheduleNativeCheck(doc.key);
  }
}
export function checkLinkedMarkdownUpdates(nativeKey: string): Promise<void> {
  const prior = running.get(nativeKey);
  if (prior) { rerun.add(nativeKey); return prior; }
  let finish!: () => void;
  const task = new Promise<void>(resolve => { finish = resolve; });
  running.set(nativeKey, task);
  pending.set(nativeKey, { generation: getSessionGeneration(nativeKey), finish });
  pumpChecks();
  return task;
}

function pumpChecks(): void {
  while (activeChecks < MAX_ACTIVE_CHECKS && pending.size) {
    const [key, queued] = pending.entries().next().value!;
    pending.delete(key);
    if (!useDocumentStore.getState().getDocument(key) || queued.generation !== getSessionGeneration(key)) {
      running.delete(key); rerun.delete(key); queued.finish(); continue;
    }
    activeChecks++;
    const controller = new AbortController(); controllers.set(key, controller);
    void check(key, controller.signal).catch(error => {
      // Check normally publishes its own diagnostics. Keep an unexpected adapter
      // failure observable without leaving a scheduler slot or promise stuck.
      console.error('关联 Markdown 检查失败:', error);
    }).finally(() => {
      activeChecks--; running.delete(key);
      if (controllers.get(key) === controller) controllers.delete(key);
      queued.finish();
      if (rerun.delete(key) && useDocumentStore.getState().getDocument(key)) scheduleNativeCheck(key);
      pumpChecks();
    });
  }
}

function stillCurrent(key: string, generation: number, baseline: string | null, path: string): Document | undefined {
  const current = useDocumentStore.getState().getDocument(key);
  const link = current && nativeMarkdownLink(key, current.content);
  return current && current.baselineContent === baseline && getSessionGeneration(key) === generation && link && sameKey(link.path, path) ? current : undefined;
}

async function check(key: string, signal: AbortSignal): Promise<void> {
  const initial = useDocumentStore.getState().getDocument(key);
  const link = initial?.kind === 'noteboard' && nativeMarkdownLink(key, initial.content);
  if (!initial || !link) { publish(key); return; }
  const generation = getSessionGeneration(key), baselineSource = initial.baselineContent;
  let externalHash: string | undefined;
  const fail = (reason: LinkedMarkdownConflict['reason'], message: string, blockPath?: number[]) => {
    if (!signal.aborted && stillCurrent(key, generation, baselineSource, link.path)) publish(key, { nativeKey: key, markdownPath: link.path, reason, message, externalHash, blockPath });
  };
  try {
    const disk = await ipc.readDocument(link.path);
    if (disk.content == null) throw new Error('关联 Markdown 没有可读取的正文。');
    externalHash = await documentTextHash(disk.content);
    signal.throwIfAborted();
    if (!stillCurrent(key, generation, baselineSource, link.path)) return;
    const receipt = acceptance(initial, link.path);
    const baselineMetadata = readNativeMetadata(baselineSource ?? initial.content ?? '');
    if (externalHash === (receipt?.hash ?? baselineMetadata.markdown?.baselineHash)) {
      if (receipt && !receipt.explicit && readNativeMetadata(initial.content ?? '').markdown?.baselineHash !== receipt.hash) {
        fail('overlap', '此前合并的关联 Markdown 更新已被撤销，请选择保留当前原生文档或查看 Markdown。'); return;
      }
      publish(key); return;
    }
    if (!baselineSource || !baselineMetadata.markdown || !sameKey(markdownLinkPath(key, baselineMetadata) ?? '', link.path)
      || baselineMetadata.markdown.projectionVersion !== MARKDOWN_PROJECTION_VERSION) {
      fail('projection', '关联 Markdown 的基线不可用，请查看文件后选择处理方式。'); return;
    }
    if (useDocumentStore.getState().getDocument(link.path)?.isDirty) { fail('busy', '关联 Markdown 标签页有未保存的修改，请先保存或关闭它。'); return; }
    const directory = parentDirectory(key) === parentDirectory(link.path) ? '' : parentDirectory(key);
    const projectedSource = await prepareTextExport(baselineSource, 'md', directory, signal, 'noteboard');
    const [projectedNative, externalNative] = await Promise.all([
      prepareTextExport(projectedSource, 'noteboard', '', signal, 'markdown'),
      prepareTextExport(disk.content, 'noteboard', '', signal, 'markdown'),
    ]);
    if (!stillCurrent(key, generation, baselineSource, link.path)) return;
    const captured = await flushDocument(key, 'export');
    if (getEditorCapabilities(key) && !captured) { fail('busy', '编辑器输入尚未确认，请稍后重新检查关联 Markdown。'); return; }
    const current = stillCurrent(key, generation, baselineSource, link.path);
    if (!current || current.content == null) return;
    const revision = getDocumentRevision(key);
    const merged = await prepareLinkedMarkdownMerge({ baselineSource, currentSource: current.content, projectedNative, externalNative, externalHash, accepted: receipt?.patches }, signal);
    if (getDocumentRevision(key) !== revision || stillCurrent(key, generation, baselineSource, link.path)?.content !== current.content) { rerun.add(key); return; }
    if (merged.kind === 'invalid') { fail('invalid-native', merged.message); return; }
    if (merged.kind === 'conflict') { fail(merged.reason, merged.message, merged.path); return; }
    const application = await loadApplication();
    signal.throwIfAborted();
    if (getDocumentRevision(key) !== revision || stillCurrent(key, generation, baselineSource, link.path)?.content !== current.content) { rerun.add(key); return; }
    if (accepted.get(key) !== receipt) return;
    application(key, current.content, merged.content);
    accepted.set(key, { generation, path: link.path, baseline: baselineSource, hash: externalHash, patches: merged.patches });
    publish(key);
  } catch (error) { fail('unreadable', error instanceof Error ? error.message : '无法读取或处理关联 Markdown，请查看文件后重试。'); }
}

async function loadApplication(): Promise<(key: string, before: string, content: string) => void> {
  const [instances, codec, sourceSync, state, history, registry] = await Promise.all([
    import('../editor-md/editorInstances'), import('../editor-md/editorDocumentCodec'), import('../editor-md/sourceDocumentSync'),
    import('@codemirror/state'), import('../history/documentHistory'), import('../../core/editor/editorRegistry'),
  ]);
  return (key, before, content) => {
    const editor = instances.getMdTipTapEditor(key); if (editor) codec.parseEditorDocument(editor, content, 'sync');
    const source = instances.getMdSourceView(key);
    if (source && source.state.doc.toString() !== content) source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: content }, annotations: [state.Transaction.addToHistory.of(false), sourceSync.sourceReplacement.of(true)] });
    const mode = useWindowStore.getState().getTab(key)?.viewMode === 'source' ? 'source' : 'visual';
    if (history.getCurrentDocumentHistoryContent(key) == null) history.initializeDocumentHistory(key, before, mode);
    history.recordDocumentChange(key, content, { mode, startsNewGroup: true });
    registry.bumpDocumentRevision(key);
    useDocumentStore.getState().setContent(key, content);
    useWindowStore.getState().setTabDirty(key, useDocumentStore.getState().getDocument(key)?.isDirty ?? true);
  };
}

/** Only call from the explicit “keep NB and update Markdown” action. This reads
 * the latest external version; the later paired save still verifies that hash. */
export async function acceptLinkedMarkdownOverwrite(nativeKey: string): Promise<boolean> {
  const doc = useDocumentStore.getState().getDocument(nativeKey), link = doc && nativeMarkdownLink(nativeKey, doc.content);
  if (!doc || !link) return false;
  const generation = getSessionGeneration(nativeKey);
  try {
    if (useDocumentStore.getState().getDocument(link.path)?.isDirty) throw new Error('关联 Markdown 有未保存的修改，请先处理它。');
    const disk = await ipc.readDocument(link.path);
    if (disk.content == null) throw new Error('无法读取关联 Markdown。');
    const hash = await documentTextHash(disk.content);
    if (!stillCurrent(nativeKey, generation, doc.baselineContent, link.path)) return false;
    accepted.set(nativeKey, { generation, path: link.path, baseline: doc.baselineContent, hash, patches: [], explicit: true });
    publish(nativeKey);
    return true;
  } catch (error) {
    publish(nativeKey, { nativeKey, markdownPath: link.path, reason: 'unreadable', message: error instanceof Error ? error.message : '无法读取关联 Markdown。' });
    return false;
  }
}

/** Explicit recovery action when the linked file is unavailable. The association
 * is removed as an ordinary undoable in-memory edit; the NB disk baseline stays
 * untouched until the existing native save command commits this change. */
export async function unlinkMarkdownAssociation(nativeKey: string): Promise<boolean> {
  const initial = useDocumentStore.getState().getDocument(nativeKey);
  const link = initial?.kind === 'noteboard' && nativeMarkdownLink(nativeKey, initial.content);
  if (!initial || !link) return false;
  const generation = getSessionGeneration(nativeKey);
  try {
    const application = await loadApplication();
    const captured = await flushDocument(nativeKey, 'export');
    if (getEditorCapabilities(nativeKey) && !captured) throw new Error('编辑器输入尚未确认，请稍后重试解除关联。');
    const current = stillCurrent(nativeKey, generation, initial.baselineContent, link.path);
    if (!current || current.content == null) return false;
    const { markdown: _markdown, ...metadata } = readNativeMetadata(current.content);
    const content = replaceNativeMetadata(current.content, metadata);
    application(nativeKey, current.content, content);
    clearLinkedMarkdownSession(nativeKey);
    return true;
  } catch (error) {
    if (stillCurrent(nativeKey, generation, initial.baselineContent, link.path)) publish(nativeKey, {
      nativeKey, markdownPath: link.path, reason: 'unreadable', message: error instanceof Error ? error.message : '解除关联失败，请重试。',
    });
    return false;
  }
}
