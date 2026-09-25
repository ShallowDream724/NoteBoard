import { save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as ipc from '../../core/ipc/commands';
import { encodeNativeDocument, readNativeMetadata, replaceNativeMetadata } from '../../core/nativeDocument';
import { documentTextHash, saveNativeBundle } from '../../core/nativeDocumentIO';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { showToast } from '../../stores/toastStore';
import { clearDocumentHistory } from '../history/documentHistory';
import { getBaseline } from '../editor-md/serialize';
import { prepareTextExport } from '../export/documentConversion';
import { normalizePath } from '../explorer/pathUtils';
import { noteSelfWrite } from '../explorer/directoryWatcher';
import { assertDocumentIdentity, commitDocumentIdentity, prepareDocumentIdentity, protectDocumentIdentity, type DocumentIdentityLease } from '../session/documentIdentity';
import { flushDocument, getSessionGeneration } from '../session/documentSession';
import { MARKDOWN_PROJECTION_VERSION, parentDirectory, relativeDocumentPath } from './nativeLink';

const isSessionCurrent = (key: string, generation: number) => getSessionGeneration(key) === generation;

/** Converts one captured Markdown document, then publishes a new editor identity. */
export async function convertMarkdownToNative(key: string, options: { removeMarkdown: boolean }): Promise<string | null> {
  const original = useDocumentStore.getState().getDocument(key);
  if (!original || original.kind !== 'markdown') return null;
  const generation = getSessionGeneration(key);
  const hasFile = !key.startsWith('untitled:');
  const target = hasFile ? key.replace(/\.(?:md|markdown)$/i, '.nb') : await save({ defaultPath: `${original.displayName.replace(/\.[^.]+$/, '')}.nb`, filters: [{ name: 'NoteBoard 文档', extensions: ['nb', 'nbdoc'] }] });
  if (!target || !isSessionCurrent(key, generation)) return null;
  const newKey = normalizePath(target);
  if (newKey === key || useWindowStore.getState().getTab(newKey)) { showToast('目标文档已打开，请先关闭它后重试', 'warning'); return null; }
  const label = getCurrentWindow().label;
  const registration = await ipc.registerDocument(label, newKey, 'noteboard');
  if (registration.type === 'already-open') { showToast('目标文档已打开，请先关闭它后重试', 'warning'); return null; }
  let committed = false;
  let lease: DocumentIdentityLease | undefined;
  try {
    if (!isSessionCurrent(key, generation)) return null;
    lease = protectDocumentIdentity(key);
    await prepareDocumentIdentity(lease);
    const captured = await flushDocument(key, 'save');
    assertDocumentIdentity(lease);
    const current = useDocumentStore.getState().getDocument(key);
    const source = captured?.content ?? current?.content;
    if (source == null || !current) throw new Error('无法读取最新正文，请稍后重试。');
    const disk = hasFile ? await ipc.readDocument(key) : null;
    if (disk && disk.content == null) throw new Error('无法读取原 Markdown，转换未保存。');
    if (disk && (current.persistedContent == null || await documentTextHash(disk.content!) !== await documentTextHash(current.persistedContent))) throw new Error('原 Markdown 已在外部修改，请先处理外部更新。');
    const native = await prepareTextExport(source, 'noteboard', hasFile ? parentDirectory(key) : '');
    const markdown = disk && !options.removeMarkdown ? await prepareTextExport(native, 'md', '', undefined, 'noteboard') : null;
    const content = markdown == null ? native : replaceNativeMetadata(native, { markdown: { path: relativeDocumentPath(newKey, key), baselineHash: await documentTextHash(markdown), projectionVersion: MARKDOWN_PROJECTION_VERSION } });
    assertDocumentIdentity(lease);
    const expectedHash = disk ? await documentTextHash(disk.content!) : '';
    const result = await saveNativeBundle({ path: newKey, content, createOnly: true,
      ...(disk && markdown != null ? { markdown: { path: key, content: markdown, expectedHash, encoding: disk.encoding, eol: disk.eol } } : {}),
      ...(disk && options.removeMarkdown ? { removeMarkdown: { path: key, expectedHash } } : {}),
    });
    if (!result.ok || !result.native) throw new Error(result.error?.message ?? '未能保存 NoteBoard 文档。');
    assertDocumentIdentity(lease);
    noteSelfWrite(newKey); if (disk) noteSelfWrite(key);
    const [parser, references] = await Promise.all([import('../editor-md/documentExtensions'), import('../../core/documentReferences')]);
    await ipc.unregisterDocument(label, key).catch(() => undefined);
    assertDocumentIdentity(lease);
    const displayName = newKey.split(/[\\/]/).pop()!;
    commitDocumentIdentity(key, newKey, () => {
      const latest = useDocumentStore.getState().getDocument(key)?.content ?? source;
      let finalContent = content;
      if (latest !== source) {
        const document = parser.parseMarkdownDocument(latest).toJSON();
        references.rebaseDocumentReferences(document, hasFile ? parentDirectory(key) : '');
        finalContent = encodeNativeDocument(document, readNativeMetadata(content));
      }
      // Source histories use different grammars; the feature itself starts a new undoable transaction.
      clearDocumentHistory(newKey);
      useDocumentStore.getState().remove(key);
      useDocumentStore.getState().upsertFromPayload({ key: newKey, displayName, dirPath: parentDirectory(newKey), kind: 'noteboard', language: 'plaintext', content: finalContent, encoding: 'utf8', eol: 'lf', readonly: false, ...result.native! });
      useDocumentStore.getState().updateBaseline(newKey, content, result.native!.mtime, result.native!.size);
      getBaseline(newKey).updateBaseline(content);
      useWindowStore.getState().updateTabPath(key, newKey, displayName);
      useWindowStore.getState().setTabDirty(newKey, finalContent !== content);
    });
    committed = true;
    return newKey;
  } finally {
    lease?.release();
    if (!committed) await ipc.unregisterDocument(label, newKey).catch(() => undefined);
  }
}
