/** Presentation metadata shared by the editor and exported document, without UI state. */
export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';
export const ALERT_META: Record<AlertKind, { label: string; icon: string; color: string }> = {
  note: { label: 'Note', color: '#0969da', icon: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6M12 7h.01' },
  tip: { label: 'Tip', color: '#1a7f37', icon: 'M9 18h6M10 22h4M9 14a6 6 0 1 1 6 0c-1 .7-1 1.7-1 4h-4c0-2.3 0-3.3-1-4Z' },
  important: { label: 'Important', color: '#8250df', icon: 'M21 15V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4v4l5-4h7a1 1 0 0 0 1-1ZM12 7v5M12 14h.01' },
  warning: { label: 'Warning', color: '#9a6700', icon: 'm10.3 3.9-8.6 14.4a2 2 0 0 0 1.7 3h17.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01' },
  caution: { label: 'Caution', color: '#cf222e', icon: 'M12 22c4.4 0 7-3.2 7-7 0-2.8-1.7-4.8-3-6-.2 2.2-1.2 3.5-2.3 4.2C14 9.7 12.8 6 9 2c.3 3.3-1.3 5.8-3.1 8.2C4.7 11.8 5 13.4 5 15c0 3.8 2.6 7 7 7Z' },
};
export function alertKind(value: unknown): AlertKind {
  const kind = String(value ?? '').toLowerCase();
  return kind in ALERT_META ? kind as AlertKind : 'note';
}

/** Stable common-use order; completion never needs history scans or network ranking. */
export const ALERT_CHOICES: ReadonlyArray<{ kind: AlertKind; description: string }> = [
  { kind: 'note', description: '备注与补充信息' }, { kind: 'tip', description: '建议与小技巧' },
  { kind: 'important', description: '重要信息' }, { kind: 'warning', description: '需要注意的风险' },
  { kind: 'caution', description: '谨慎操作' },
];
export const matchAlertChoices = (query: string) => ALERT_CHOICES.filter(item => item.kind.startsWith(query.toLowerCase()));
