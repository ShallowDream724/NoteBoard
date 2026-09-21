import { convertFileSrc } from '@tauri-apps/api/core';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import { useDocumentStore } from '../../stores/documentStore';
import { useWindowStore } from '../../stores/windowStore';
import { useFontPackStore } from '../../stores/fontPackStore';
import { renderDocument } from './renderDocument';

export async function captureDocument(key: string, signal?: AbortSignal) {
  const capability = getEditorCapabilities(key);
  const snapshot = capability ? await capability.flush('export') : null;
  const document = useDocumentStore.getState().getDocument(key);
  const tab = useWindowStore.getState().tabs.find(tab => tab.key === key);
  if (!tab || !document || (capability && snapshot?.content == null)) throw new Error('当前文档暂时无法导出');
  const markdown = snapshot?.content ?? document.content;
  if (markdown == null) throw new Error('当前文档没有可导出的文本');
  return renderDocument(markdown, tab.displayName, document.dirPath ?? '', signal);
}
export function exportFontCss() {
  const css = getComputedStyle(document.documentElement);
  const faces = useFontPackStore.getState().status?.faces ?? [];
  const quoted = (value: string) => JSON.stringify(value);
  return `:root{--export-body-font:${css.getPropertyValue('--content-font-family') || "'Segoe UI','Microsoft YaHei',sans-serif"};--export-mono-font:${css.getPropertyValue('--mono-font-family') || 'Consolas,monospace'};}`
    + faces.map(face => `@font-face{font-family:${quoted(face.family)};font-style:${face.style};font-weight:${face.weight};src:url(${quoted(convertFileSrc(face.path))})}`).join('\n');
}
