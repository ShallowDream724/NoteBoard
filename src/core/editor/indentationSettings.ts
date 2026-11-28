export interface IndentationSettings {
  insertSpaces: boolean;
  tabSize: number;
}

export function normalizeTabSize(tabSize: number | undefined): number {
  return Math.max(1, Math.min(8, Math.trunc(tabSize ?? 2) || 2));
}

export function resolveIndentation(defaults: Partial<IndentationSettings>, file?: Partial<IndentationSettings>): IndentationSettings {
  return {
    insertSpaces: (file?.insertSpaces ?? defaults.insertSpaces) !== false,
    tabSize: normalizeTabSize(file?.tabSize ?? defaults.tabSize),
  };
}
