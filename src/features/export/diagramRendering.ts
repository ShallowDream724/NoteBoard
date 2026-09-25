import type { DiagramLanguage } from '../editor-md/diagramSyntax';

export interface DiagramRequest { kind: DiagramLanguage; code: string }
export interface DiagramResult { html: string; error?: string }
export type DiagramRenderer = (requests: DiagramRequest[]) => Promise<DiagramResult[]>;
export const DIAGRAM_LABELS: Record<DiagramLanguage, string> = { mermaid: 'Mermaid 图表', plantuml: 'PlantUML 图表', infographic: '信息图' };
