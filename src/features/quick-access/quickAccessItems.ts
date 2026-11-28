import { normalizePath } from '../explorer/pathUtils';
import type { DocumentSearchSelection } from '../search/openDocumentSearch';

export type QuickAccessMode = 'files' | 'commands' | 'navigation';
export interface QuickAccessRequest {
  mode: QuickAccessMode;
  previousFocus: HTMLElement | null;
  searchSelection?: DocumentSearchSelection;
}

export const QUICK_ACCESS_COMMANDS = { files: 'workspace.quickOpen', commands: 'workspace.commandPalette' } as const;

interface SearchableItem {
  id: string;
  label: string;
  detail?: string;
}

export interface QuickFile extends SearchableItem {
  type: 'file';
  path: string | null;
  tabKey?: string;
  source: '已打开' | '最近打开' | '工作区';
}

export interface QuickCommand extends SearchableItem {
  type: 'command';
  run: () => unknown;
  shortcut?: string;
}

export interface QuickNavigation extends SearchableItem {
  type: 'heading' | 'bookmark' | 'symbol' | 'return';
  run: () => unknown;
}

function searchText(text: string) {
  return text.toLowerCase().replaceAll('\\', '/');
}

function scoreTerm(label: string, detail: string, term: string) {
  if (label === term) return 0;
  if (label.startsWith(term)) return 1;
  if (label.includes(term)) return 2;
  if (detail.includes(term)) return 3;
  // Allow abbreviations such as `rme` for README; path matches stay literal.
  if (!/^[a-z\d]{2,}$/.test(term)) return Infinity;
  let position = -1;
  for (const letter of term) {
    position = label.indexOf(letter, position + 1);
    if (position < 0) return Infinity;
  }
  return 4;
}

export function matchQuickAccessItems<T extends SearchableItem>(items: readonly T[], query: string) {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...items];
  return items.flatMap(item => {
    const label = searchText(item.label), detail = searchText(item.detail ?? '');
    const score = terms.reduce((total, term) => total + scoreTerm(label, detail, term), 0);
    return Number.isFinite(score) ? [{ item, score }] : [];
  }).sort((a, b) => a.score - b.score).map(({ item }) => item);
}

export function filePathItem(path: string, source: QuickFile['source']): QuickFile {
  const normalized = normalizePath(path);
  const label = normalized.split('\\').at(-1) || path;
  return { id: normalized.toLowerCase(), type: 'file', label, detail: path, path, source };
}

export function mergeQuickFiles(...groups: ReadonlyArray<readonly QuickFile[]>) {
  const unique = new Map<string, QuickFile>();
  for (const files of groups) {
    for (const file of files) {
      if (!unique.has(file.id)) unique.set(file.id, file);
    }
  }
  return Array.from(unique.values());
}
