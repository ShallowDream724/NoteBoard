import definitions from './shortcutCatalog.json';
export type ShortcutContext = 'app' | 'markdown' | 'source' | 'code' | 'explorer' | 'diagram' | 'mindmap' | 'search';
export interface ShortcutDefinition { id: string; label: string; group: string; contexts: ShortcutContext[]; defaults: string[] }
/** Shared with Rust settings validation. Editors supply execution, never defaults. */
export const SHORTCUTS = definitions as ShortcutDefinition[];
export const SHORTCUT_BY_ID = new Map(SHORTCUTS.map(definition => [definition.id, definition]));
