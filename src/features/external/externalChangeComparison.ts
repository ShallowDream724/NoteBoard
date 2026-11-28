import { normalizeDocumentEol } from '../../core/documentText';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { readDiskText } from '../../core/files/readDiskText';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { getSessionGeneration, isClosing } from '../session/documentSession';

const MAX_DISK_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 250_000;
const MAX_LINES = 10_000;

export interface ExternalChangeComparison {
  editorText: string;
  diskText: string;
}

function sizeLimitError() {
  return new Error('文件超过差异查看上限（每个版本 25 万字符、1 万行，磁盘文件 512 KiB）。');
}

function comparisonText(text: string): string {
  if (text.length > MAX_TEXT_CHARS) throw sizeLimitError();
  const normalized = normalizeDocumentEol(text);
  let lines = 1;
  for (let newline = normalized.indexOf('\n'); newline !== -1; newline = normalized.indexOf('\n', newline + 1)) {
    if (++lines > MAX_LINES) throw sizeLimitError();
  }
  return normalized;
}

/** Disk I/O first, then read the latest editor text without flushing pending input. */
export async function readExternalChangeComparison(
  docKey: string,
  signal: AbortSignal,
): Promise<ExternalChangeComparison> {
  const generation = getSessionGeneration(docKey);
  function currentDocument() {
    const doc = useDocumentStore.getState().getDocument(docKey);
    if (signal.aborted || getSessionGeneration(docKey) !== generation
      || isClosing(docKey) || useWindowStore.getState().isTransferring(docKey)
      || doc?.loadState !== 'loaded' || doc.externalStatus !== 'modified'
      || (doc.kind !== 'markdown' && doc.kind !== 'code')) {
      throw new Error('文件状态已变化，请关闭后重新查看。');
    }
    return doc;
  }

  const disk = await readDiskText(docKey, currentDocument().encodingOverride, MAX_DISK_BYTES);
  const doc = currentDocument();
  if (disk.kind !== doc.kind || disk.content == null) throw new Error('无法读取磁盘文件的文本。');
  const diskText = comparisonText(disk.content);

  // Preserve the original source of clean documents, including Markdown syntax
  // that the visual editor represents in another form.
  const editor = doc.isDirty ? getEditorCapabilities(docKey) : null;
  const snapshot = editor?.readTextSnapshot?.(MAX_TEXT_CHARS);
  if (snapshot === 'too-large') throw sizeLimitError();
  const content = editor ? snapshot?.content
    : (doc.isDirty ? doc.content : doc.persistedContent ?? doc.content);
  if (content == null) throw new Error('无法读取当前编辑内容，请重试。');
  return { editorText: comparisonText(content), diskText };
}
