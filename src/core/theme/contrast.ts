// NoteBoard WCAG 2.1 对比度计算
// 详见 docs/06-主题与设计规范.md §11
// 算法来源：https://www.w3.org/TR/WCAG21/#dfn-relative-luminance

import type { ThemeId } from '../ipc/types';

/** RGB channels only. Use parseColorWithAlpha/compositeColor when transparency affects the displayed result. */
export function parseColor(color: string): [number, number, number] {
  const [r, g, b] = parseColorWithAlpha(color);
  return [r, g, b];
}

/** Supports RGB/RGBA functions and HEX3/HEX4/HEX6/HEX8, preserving alpha. */
export function parseColorWithAlpha(c: string): [number, number, number, number] {
  const trimmed = c.trim();
  const functional = /^rgba?\(\s*([^()]+)\s*\)$/i.exec(trimmed);
  if (functional) {
    const parts = functional[1].trim().split(/[\s,/]+/);
    if ((parts.length === 3 || parts.length === 4) && parts.every(value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value))) {
      const channel = (value: string, maximum: number) => Math.max(0, Math.min(maximum, value.endsWith('%') ? parseFloat(value) / 100 * maximum : parseFloat(value)));
      return [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255), parts[3] === undefined ? 1 : channel(parts[3], 1)];
    }
  }
  const match = /^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(trimmed);
  if (!match) throw new Error(`无法解析颜色值: ${c}`);
  const value = match[1].length <= 4 ? [...match[1]].map(character => character + character).join('') : match[1];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1];
}

const mix = (foreground: [number, number, number, number], background: readonly number[]) =>
  foreground.slice(0, 3).map((channel, index) => Math.round(channel * foreground[3] + background[index] * (1 - foreground[3])));
const hex = (channels: readonly number[]) => `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;

/** Opaque screen result: source-over background; a translucent background itself is laid over white. Never persists the result. */
export function compositeColor(color: string, background = '#ffffff'): string {
  const surface = mix(parseColorWithAlpha(background), [255, 255, 255]);
  return hex(mix(parseColorWithAlpha(color), surface));
}

/** sRGB 通道值 → 线性光 */
function channelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/**
 * 计算相对亮度（WCAG 2.1）
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function relativeLuminance(color: string, background = '#ffffff'): number {
  const [r, g, b] = parseColor(compositeColor(color, background));
  const rl = channelToLinear(r);
  const gl = channelToLinear(g);
  const bl = channelToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * 计算两个颜色之间的对比度（1.0 ~ 21.0）
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 *
 * 如果有 alpha，先与指定背景混合（alpha 合成）
 */
export function contrastRatio(fg: string, bg: string, canvas = '#ffffff'): number {
  const background = compositeColor(bg, canvas);
  const l1 = relativeLuminance(compositeColor(fg, background));
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 正文类对比度阈值（WCAG AA） */
export const TEXT_CONTRAST_THRESHOLD = 4.5;

/** 功能性指示对比度阈值（WCAG 1.4.11 非文本内容） */
export const UI_CONTRAST_THRESHOLD = 3.0;

// ── 从 CSS 中读取 Token 值 ──

/**
 * 获取指定主题下某个 CSS 变量的值
 * 通过临时创建元素、设置 data-theme、读取 getComputedStyle 实现
 */
export function getTokenValue(theme: ThemeId, token: string): string {
  if (typeof document === 'undefined') {
    throw new Error('getTokenValue 只能在浏览器环境中调用');
  }
  const root = document.documentElement;
  const prevTheme = root.dataset.theme;
  root.dataset.theme = theme;
  const value = getComputedStyle(root).getPropertyValue(token).trim();
  if (prevTheme) {
    root.dataset.theme = prevTheme;
  } else {
    delete root.dataset.theme;
  }
  if (!value) {
    throw new Error(`Token ${token} 在主题 ${theme} 中未定义`);
  }
  return value;
}

/**
 * 检查指定主题的指定 Token 对是否满足对比度阈值
 */
export function checkContrast(
  theme: ThemeId,
  fgToken: string,
  bgToken: string,
  threshold: number,
): { ratio: number; pass: boolean } {
  const fg = getTokenValue(theme, fgToken);
  const bg = getTokenValue(theme, bgToken);
  const ratio = contrastRatio(fg, bg);
  return { ratio, pass: ratio >= threshold };
}
