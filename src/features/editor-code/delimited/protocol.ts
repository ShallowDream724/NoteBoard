import type { DelimitedCellValue, DelimitedSummary, DelimitedWindowRequest, DelimitedWindowRow, Delimiter } from './parser';

export type DelimitedRequest =
  | { id: number; type: 'load'; text: string; delimiter: Delimiter }
  | { id: number; type: 'window'; range: DelimitedWindowRequest }
  | { id: number; type: 'cell'; row: number; column: number };

export type DelimitedResponse =
  | { id: number; type: 'ready'; summary: DelimitedSummary }
  | { id: number; type: 'window'; rows: DelimitedWindowRow[] }
  | { id: number; type: 'cell'; cell: DelimitedCellValue }
  | { id: number; type: 'error'; message: string };
