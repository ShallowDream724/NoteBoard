// NoteBoard 文件格式兼容接口（元数据来自 fileFormats.json）
// Rust file_formats.rs 读取同一份清单；图标与编辑器实现各自封装。
// 详见 docs/08-数据契约与持久化.md §5.2

import { fileExtension, getFileFormat } from './fileFormats';
export { KIND_BY_EXT, LANGUAGE_BY_EXT, LANGUAGE_BY_FILENAME } from './fileFormats';
import type { DocumentKind, LanguageId, SavePolicy } from './ipc/types';


/** 从路径提取扩展名（小写，无点） */
export function extFromPath(path: string): string {
  return fileExtension(path);
}

/** 从路径推断 DocumentKind */
export function kindFromPath(path: string): DocumentKind {
  return getFileFormat(path).kind;
}

/** 从路径推断 LanguageId */
export function languageFromPath(path: string): LanguageId {
  return getFileFormat(path).language;
}

/** 从 kind 推导保存策略 */
export function savePolicyOf(kind: DocumentKind): SavePolicy {
  switch (kind) {
    // markdown、board、mindmap、drawio 及 bitable 多维表格均支持自动保存策略
    case 'markdown':
    case 'noteboard':
    case 'board':
    case 'mindmap':
    case 'drawio':
    case 'bitable':
      return 'auto';
    case 'code':
    case 'image':
    case 'unsupported':
      return 'manual';
  }
}

export function isRichDocument(kind: DocumentKind | undefined): kind is 'markdown' | 'noteboard' {
  return kind === 'markdown' || kind === 'noteboard';
}

/** 判断是否为受支持的可编辑类型 */
export function isEditable(kind: DocumentKind): boolean {
  // 图片为专用预览查看模式，不支持直接文本/画板编辑
  return kind !== 'unsupported' && kind !== 'image';
}
