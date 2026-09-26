import type { CSSProperties } from 'react';
import { ALERT_META, alertKind, type AlertKind } from './alertPresentation';
import { documentColor } from '../document-style/colors';

export type CalloutAttributes = {
  kind: AlertKind;
  /** null follows the GFM preset; an empty string explicitly hides the title. */
  title: string | null;
  /** null follows the preset; otherwise a preset SVG name or one emoji grapheme. */
  icon: string | null;
  textColor: string | null;
  borderColor: string | null;
  backgroundColor: string | null;
};
export const CALLOUT_DEFAULTS: CalloutAttributes = {
  kind: 'note', title: null, icon: null, textColor: null, borderColor: null, backgroundColor: null,
};
export const CALLOUT_EMOJI = ['💡', '📌', '✨', '🎯', '📝', '✅', '❓', '⚠️', '🔍', '🌱', '❤️', '🚀'] as const;
export const CALLOUT_BACKGROUNDS = ['#f1f5f9', '#fff1f2', '#fff7ed', '#fefce8', '#f0fdf4', '#eff6ff', '#faf5ff'];
/** Native icon choices are independent of the five portable GFM alert kinds. */
export const CALLOUT_EXTRA_ICONS = {
  success: { label: '完成', icon: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 12l3 3 5-6' },
} as const;
const CALLOUT_ICON_META = { ...ALERT_META, ...CALLOUT_EXTRA_ICONS };
const isPresetIcon = (value: unknown): value is keyof typeof CALLOUT_ICON_META =>
  typeof value === 'string' && Object.hasOwn(CALLOUT_ICON_META, value);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const isAlertKind = (value: unknown): value is AlertKind => typeof value === 'string' && Object.hasOwn(ALERT_META, value);
export const isCalloutTitle = (value: unknown): value is string | null => value === null
  || typeof value === 'string' && value.length <= 500 && !/\p{Cc}/u.test(value);
export function isCalloutIcon(value: unknown): value is string | null {
  if (value === null || isPresetIcon(value)) return true;
  if (typeof value !== 'string' || !value || value.length > 32 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)) return false;
  const segments = segmenter.segment(value)[Symbol.iterator]();
  return !segments.next().done && segments.next().done === true;
}
export const isCalloutColor = (value: unknown): value is string | null => value === null || documentColor(value) !== null;
export function calloutAttributes(attrs: Record<string, unknown> = {}): CalloutAttributes {
  return {
    kind: alertKind(attrs.kind), title: isCalloutTitle(attrs.title) ? attrs.title : null,
    icon: isCalloutIcon(attrs.icon) ? attrs.icon : null,
    textColor: documentColor(attrs.textColor), borderColor: documentColor(attrs.borderColor), backgroundColor: documentColor(attrs.backgroundColor),
  };
}
export const calloutTitle = (attrs: Record<string, unknown>) => {
  const value = calloutAttributes(attrs); return value.title === null ? ALERT_META[value.kind].label : value.title;
};
export const calloutEmoji = (attrs: Record<string, unknown>) => {
  const value = calloutAttributes(attrs).icon; return value && !isPresetIcon(value) ? value : '';
};
export const calloutSvgIcon = (attrs: Record<string, unknown>) => {
  const value = calloutAttributes(attrs);
  return CALLOUT_ICON_META[isPresetIcon(value.icon) ? value.icon : value.kind].icon;
};
export function calloutStyle(attrs: Record<string, unknown>): CSSProperties {
  const value = calloutAttributes(attrs);
  const channels = value.backgroundColor?.slice(1).match(/../g)?.map(channel => {
    const component = parseInt(channel, 16) / 255; return component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4;
  });
  const autoText = channels ? .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '#18202b' : '#f8fafc' : null;
  const text = value.textColor ?? autoText;
  return {
    '--callout-accent': `var(--alert-${value.kind}-border, ${ALERT_META[value.kind].color})`,
    ...(text ? { '--callout-text': text } : {}),
    ...(value.borderColor ? { '--callout-border': value.borderColor } : {}),
    ...(value.backgroundColor ? { '--callout-background': value.backgroundColor } : {}),
  } as CSSProperties;
}
export const calloutStyleText = (attrs: Record<string, unknown>) => Object.entries(calloutStyle(attrs)).map(([key, value]) => `${key}:${value}`).join(';');
export const normalizeAlertInput = (value: string) => value.replace(/[【［]/g, '[').replace(/[】］]/g, ']').replace(/！/g, '!');
