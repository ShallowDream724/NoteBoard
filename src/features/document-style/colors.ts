/** Shared document colors. Values are data, never arbitrary CSS declarations. */
export function documentColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
export const TEXT_COLORS = [
  { color: null, name: '默认文字颜色' }, { color: '#64748b', name: '灰色' },
  { color: '#dc2626', name: '红色' }, { color: '#c2410c', name: '橙色' },
  { color: '#a16207', name: '金色' }, { color: '#15803d', name: '绿色' },
  { color: '#2563eb', name: '蓝色' }, { color: '#7c3aed', name: '紫色' },
] as const;
export const BACKGROUND_COLORS = [
  { color: null, name: '透明' }, { color: '#f1f5f9', name: '浅灰' },
  { color: '#fecaca', name: '浅红' }, { color: '#fed7aa', name: '浅橙' },
  { color: '#fef08a', name: '浅黄' }, { color: '#bbf7d0', name: '浅绿' },
  { color: '#bfdbfe', name: '浅蓝' }, { color: '#e9d5ff', name: '浅紫' },
  { color: '#cbd5e1', name: '灰色' }, { color: '#94a3b8', name: '深灰' },
  { color: '#f87171', name: '红色' }, { color: '#fb923c', name: '橙色' },
  { color: '#facc15', name: '黄色' }, { color: '#4ade80', name: '绿色' },
  { color: '#93c5fd', name: '蓝色' }, { color: '#c4b5fd', name: '紫色' },
] as const;
