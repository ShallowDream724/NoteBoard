import { lastTextStyle, rememberTextStyle, useTextStylePreference } from '../document-style/stylePreference';

export const HIGHLIGHT_COLORS = [
  { name: '柠檬黄', color: '#fef08a' }, { name: '清新绿', color: '#bbf7d0' },
  { name: '天空蓝', color: '#bfdbfe' }, { name: '浅紫', color: '#e9d5ff' },
  { name: '蜜桃粉', color: '#fbcfe8' }, { name: '暖阳橙', color: '#fed7aa' },
  { name: '珊瑚红', color: '#fecaca' }, { name: '湖水青', color: '#a5f3fc' },
] as const;
/** Tool preference is independent of document formatting and never writes to Markdown. */
export function rememberHighlightColor(next: string) { rememberTextStyle({ background: next }); }
export function useHighlightColor() { return useTextStylePreference().background ?? HIGHLIGHT_COLORS[0].color; }
export function getLastHighlightColor() { return lastTextStyle().background ?? HIGHLIGHT_COLORS[0].color; }
