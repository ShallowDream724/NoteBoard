import { convertFileSrc } from '@tauri-apps/api/core';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useFontPackStore } from '../../stores/fontPackStore';
import { prepareDocument } from './documentConversion';
import { readMarkdownSnapshot } from '../editor-md/readDocumentSnapshot';

export async function captureDocument(key: string, signal?: AbortSignal) {
  // Give the dialog a paint before materializing the immutable document snapshot.
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  signal?.throwIfAborted();
  const document = useDocumentStore.getState().getDocument(key);
  const tab = useWindowStore.getState().tabs.find(tab => tab.key === key);
  if (!tab || !document) throw new Error('当前文档暂时无法导出');
  const content = tab.kind === 'markdown' ? readMarkdownSnapshot(key) : null;
  const capability = getEditorCapabilities(key);
  const snapshot = content == null && capability ? await capability.flush('export') : null;
  if (content == null && capability && snapshot?.content == null) throw new Error('当前文档暂时无法导出');
  const captured = content ?? snapshot?.content ?? document.content;
  if (captured == null) throw new Error('当前文档没有可导出的文本');
  return prepareDocument(captured, tab.displayName, document.dirPath ?? '', signal);
}
export function exportFontCss() {
  const css = getComputedStyle(document.documentElement);
  const faces = useFontPackStore.getState().status?.faces ?? [];
  const quoted = (value: string) => JSON.stringify(value);
  return `:root{--export-body-font:${css.getPropertyValue('--content-font-family') || "'Segoe UI','Microsoft YaHei',sans-serif"};--export-mono-font:${css.getPropertyValue('--mono-font-family') || 'Consolas,monospace'};}`
    + faces.map(face => `@font-face{font-family:${quoted(face.family)};font-style:${face.style};font-weight:${face.weight};src:url(${quoted(convertFileSrc(face.path))})}`).join('\n');
}
