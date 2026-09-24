import { SHORTCUTS, SHORTCUT_BY_ID, type ShortcutContext } from './shortcutCatalog';
export type ShortcutOverrides = Record<string, string[] | null>;
let overrides: ShortcutOverrides = {};
let revision = 0;
const subscribers = new Set<() => void>();
const order = ['Ctrl', 'Shift', 'Alt', 'Meta'];
export function normalizeShortcut(input: string): string | null {
  const parts = input.split('+').map(part => part.trim());
  const key = parts.pop();
  if (!key || parts.some(part => !order.includes(part)) || new Set(parts).size !== parts.length) return null;
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  if (!/^[A-Z0-9/.,;\[\]\\'`=\-]$|^F(?:[1-9]|1\d|2[0-4])$|^(?:Enter|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape)$/.test(normalized)) return null;
  return [...order.filter(modifier => parts.includes(modifier)), normalized].join('+');
}
export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const physical: Record<string, string> = { Slash: '/', Minus: '-', Equal: '=', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Space: 'Space' };
  const key = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1] ?? physical[event.code] ?? event.key;
  return normalizeShortcut([event.ctrlKey ? 'Ctrl' : '', event.shiftKey ? 'Shift' : '', event.altKey ? 'Alt' : '', event.metaKey ? 'Meta' : '', key].filter(Boolean).join('+'));
}
export function shortcutValidation(binding: string): string | null {
  const normalized = normalizeShortcut(binding);
  if (!normalized) return '无法识别这个组合键';
  if (normalized.includes('Meta+') || ['Ctrl+Alt+Delete', 'Alt+Tab', 'Alt+F4', 'Ctrl+Escape', 'Ctrl+Shift+Escape', 'Alt+Escape'].includes(normalized)) return '该组合由操作系统保留';
  if (!/^(?:Ctrl|Alt)\+/.test(normalized) && !normalized.includes('+Alt+') && !/^F\d+$/.test(normalized)) return '请使用 Ctrl、Alt 组合或功能键，避免覆盖正常输入';
  return null;
}
export function setShortcutOverrides(next: ShortcutOverrides) {
  const clean: ShortcutOverrides = {};
  for (const [id, values] of Object.entries(next)) {
    if (SHORTCUT_BY_ID.has(id) && Array.isArray(values) && values.length <= 4 && values.every(value => typeof value === 'string' && !shortcutValidation(value))) clean[id] = [...new Set(values.map(value => normalizeShortcut(value)!))];
  }
  if (JSON.stringify(clean) === JSON.stringify(overrides)) return;
  overrides = clean; revision++; subscribers.forEach(listener => listener());
}
export const subscribeShortcuts = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
export const shortcutRevision = () => revision;
export function commandBindings(id: string, values = overrides): readonly string[] {
  return values[id] ?? SHORTCUT_BY_ID.get(id)?.defaults ?? [];
}
export function commandForDefault(binding: string) {
  const key = normalizeShortcut(binding);
  return SHORTCUTS.find(definition => definition.defaults.includes(key ?? ''))?.id;
}
export function matchesShortcut(id: string, event: KeyboardEvent) {
  const key = shortcutFromEvent(event); return !!key && commandBindings(id).includes(key);
}
export function shortcutLabel(id: string) { return commandBindings(id).map(key => key.replaceAll('+', ' + ')).join(' / ') || '未设置'; }
export function resolveShortcut(event: KeyboardEvent, context: ShortcutContext) {
  const key = shortcutFromEvent(event); if (!key) return undefined;
  return SHORTCUTS.find(definition => definition.contexts.includes(context) && commandBindings(definition.id).includes(key));
}
/** Stop a library's old binding only after this command was actually remapped. */
export function isRetiredShortcut(event: KeyboardEvent, context: ShortcutContext) {
  const key = shortcutFromEvent(event); if (!key) return false;
  return SHORTCUTS.some(definition => definition.contexts.includes(context) && definition.defaults.includes(key) && !commandBindings(definition.id).includes(key));
}
export function shortcutConflicts(id: string, binding: string, values = overrides) {
  const command = SHORTCUT_BY_ID.get(id), key = normalizeShortcut(binding);
  if (!command || !key) return [];
  return SHORTCUTS.filter(other => other.id !== id && commandBindings(other.id, values).includes(key)
    && (command.contexts.includes('app') || other.contexts.includes('app') || command.contexts.some(context => other.contexts.includes(context))));
}
