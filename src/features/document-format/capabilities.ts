export type DocumentFormat = 'markdown' | 'noteboard';
export interface DocumentCapability {
  label: string;
  markdown: 'native' | 'html' | 'requires-noteboard';
  native: string;
  transaction: 'text' | 'mark' | 'node' | 'table' | 'document';
  resources: 'none' | 'images';
  pdf: 'text' | 'styled' | 'table' | 'images';
  pandoc: 'native' | 'html' | 'project';
  markdownProjection: string;
  diagnostic?: string;
}
const rich = (label: string, native: string, transaction: DocumentCapability['transaction'], markdownProjection: string,
  pdf: DocumentCapability['pdf'] = 'styled', resources: DocumentCapability['resources'] = 'none'): DocumentCapability => ({
  label, markdown: 'requires-noteboard', native, transaction, resources, pdf, pandoc: 'project', markdownProjection,
  diagnostic: `${label}无法由通用 Markdown 完整表达`,
});

/** Shared by commands, import/export projections, and feature visibility. */
export const DOCUMENT_CAPABILITIES = {
  text: { label: '普通文字', markdown: 'native', native: 'paragraph/text', transaction: 'text', resources: 'none', pdf: 'text', pandoc: 'native', markdownProjection: '保留文字与 Markdown 结构' },
  basicFormatting: { label: '基础格式', markdown: 'native', native: 'strong/em/strike/code', transaction: 'mark', resources: 'none', pdf: 'styled', pandoc: 'native', markdownProjection: '保留 Markdown 标记' },
  image: { label: '图片', markdown: 'native', native: 'image resource reference', transaction: 'node', resources: 'images', pdf: 'images', pandoc: 'native', markdownProjection: '标准图片链接' },
  table: { label: '普通表格', markdown: 'native', native: 'table rows/cells', transaction: 'table', resources: 'none', pdf: 'table', pandoc: 'native', markdownProjection: 'GFM 表格' },
  textColor: rich('文字颜色', 'text color', 'mark', '保留文字，移除颜色'),
  highlight: rich('高亮', 'text background', 'mark', '保留文字，移除高亮'),
  fontSize: rich('字号', 'text size', 'mark', '保留文字，移除字号'),
  alignment: rich('对齐与缩进', 'paragraph alignment/indent', 'node', '保留内容，移除任意段落对齐与缩进'),
  tableMerge: rich('合并单元格', 'cell row/column spans', 'table', '展开合并单元格', 'table'),
  tableDimensions: rich('表格尺寸', 'column widths/row heights', 'table', '移除精确尺寸', 'table'),
  tableAlignment: rich('整表位置', 'table horizontal alignment', 'node', '保留表格内容，移除整表位置', 'table'),
  tableFill: rich('表格底色', 'cell background', 'table', '移除底色', 'table'),
  tableStyle: rich('表格样式', 'table presentation', 'document', '标准 GFM 表格', 'table'),
  tableHeader: rich('首列表头', 'cell header role', 'table', '保留文字，移除首列表头语义', 'table'),
  imageLayout: rich('图片布局', 'image alignment/size', 'node', '标准图片链接', 'images', 'images'),
  gallery: rich('图片组合', 'image collection layout/slots', 'node', '按顺序展开图片', 'images', 'images'),
  annotation: rich('说明', 'annotation references/content', 'document', '说明转为正文附注'),
  conceal: rich('模糊内容', 'concealed content', 'mark', '保留文字，移除模糊效果'),
  disclosure: rich('折叠块', 'disclosure title/content', 'node', '展开标题与正文'),
} satisfies Record<string, DocumentCapability>;
export type DocumentCapabilityId = keyof typeof DOCUMENT_CAPABILITIES;
export function formatSupportsCapability(format: DocumentFormat, capability: DocumentCapabilityId): boolean {
  return format === 'noteboard' || DOCUMENT_CAPABILITIES[capability].markdown !== 'requires-noteboard';
}
export function capabilityVisible(capability: DocumentCapabilityId, pureMarkdown: boolean): boolean {
  return !pureMarkdown || formatSupportsCapability('markdown', capability);
}
