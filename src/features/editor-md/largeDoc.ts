// NoteBoard 大文档判定
// 阈值判定（仅读取长度）+ 降级到 source 模式 + 横幅
// 详见 docs/09-开发路线图.md 7.15
//
// 阈值设置：
// - VISUAL_MODE_LIMIT: 超过此值不进入 visual 模式
// - LARGE_FILE_CONFIRM: 超过此值弹确认框（FR-113）

/** 各阈值 */
export const THRESHOLDS = {
  /** 超过此字符数 → 不进 visual 模式，用 source */
  VISUAL_MODE_LIMIT: 200_000,
  /** 超过此字节数 → 读盘前弹确认框（FR-113） */
  LARGE_FILE_CONFIRM: 50 * 1024 * 1024, // 50MB
  /** 超过此字符数 → highlightAuto 跳过（代码块内） */
  HIGHLIGHT_AUTO_LIMIT: 5_000,
  /** 超过此字符数 → 单个代码块不高亮 */
  SINGLE_BLOCK_LIMIT: 20_000,
} as const;

/** 大文档判定结果 */
export interface LargeDocVerdict {
  /** 是否为大文档 */
  isLarge: boolean;
  /** 字符数 */
  charCount: number;
  /** 已知的文件字节数；源码编辑后未编码时不重新扫描正文计算 */
  byteSize?: number;
  /** 使用的阈值 */
  threshold: number;
  /** 建议的模式 */
  suggestedMode: 'visual' | 'source';
}

/**
 * 判定文档是否为大文档
 * 仅按 UTF-16 长度判定；同时接受 CodeMirror Text，拒绝大文件切换前无需展开 rope。
 */
export function judgeLargeDoc(content: { readonly length: number }, byteSize?: number): LargeDocVerdict {
  const charCount = content.length;

  // The current visual editor is not document-virtualized. Never route a large
  // file into the obsolete section scaffold or an unbounded contenteditable.
  if (charCount > THRESHOLDS.VISUAL_MODE_LIMIT) {
    return {
      isLarge: true,
      charCount,
      byteSize,
      threshold: THRESHOLDS.VISUAL_MODE_LIMIT,
      suggestedMode: 'source',
    };
  }

  // 正常文档
  return {
    isLarge: false,
    charCount,
    byteSize,
    threshold: THRESHOLDS.VISUAL_MODE_LIMIT,
    suggestedMode: 'visual',
  };
}

/**
 * 判定单个代码块是否应该跳过高亮
 */
export function shouldSkipCodeBlockHighlight(codeText: string): boolean {
  return codeText.length > THRESHOLDS.SINGLE_BLOCK_LIMIT;
}

/**
 * 判定是否应该用 highlightAuto
 * 仅 ≤5k 的代码块才用 highlightAuto
 */
export function shouldUseHighlightAuto(codeText: string): boolean {
  return codeText.length <= THRESHOLDS.HIGHLIGHT_AUTO_LIMIT;
}

/**
 * 判定是否需要在读盘前弹确认框
 */
export function shouldConfirmBeforeOpen(byteSize: number): boolean {
  return byteSize > THRESHOLDS.LARGE_FILE_CONFIRM;
}
