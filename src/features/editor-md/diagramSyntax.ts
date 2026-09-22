/** Language aliases shared by diagram grammar and source-position mapping. */
export const DIAGRAM_LANGUAGES = {
  mermaid: ['mermaid'],
  plantuml: ['plantuml', 'uml', 'puml'],
  infographic: ['infographic', 'info'],
} as const;

export type DiagramLanguage = keyof typeof DIAGRAM_LANGUAGES;

export function diagramLanguage(language: unknown): DiagramLanguage | null {
  const first = String(language ?? '').trim().split(/\s+/, 1)[0].toLowerCase();
  for (const [kind, aliases] of Object.entries(DIAGRAM_LANGUAGES)) {
    if ((aliases as readonly string[]).includes(first)) return kind as DiagramLanguage;
  }
  return null;
}
