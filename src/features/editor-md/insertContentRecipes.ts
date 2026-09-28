import type { JSONContent } from '@tiptap/core';

/** Shared initial content for the toolbar and contextual insertion entry points. */
export function mathContent(type: 'inline' | 'block'): JSONContent {
  return { type: type === 'inline' ? 'mathInline' : 'mathBlock', attrs: { latex: '' } };
}
export const DEFAULT_MERMAID_CODE = 'graph TD\n  A[开始] --> B[处理]\n  B --> C[完成]';
export const DEFAULT_INFOGRAPHIC_CODE = 'type: metric-cards\ntitle: 核心运营与业务指标\ndata:\n  - label: 日活跃用户\n    value: "128,450"\n    change: "+12.5%"\n    trend: up\n    color: blue\n  - label: 核心功能转化率\n    value: "38.6%"\n    change: "+3.2%"\n    trend: up\n    color: emerald';
export function diagramContent(type: 'mermaid' | 'infographic'): JSONContent {
  return { type: type === 'mermaid' ? 'mermaidBlock' : 'infographicBlock', attrs: { code: type === 'mermaid' ? DEFAULT_MERMAID_CODE : DEFAULT_INFOGRAPHIC_CODE } };
}
