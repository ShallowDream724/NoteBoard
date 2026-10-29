import type { JSONContent } from '@tiptap/core';

export interface AuthoringDiagnostic { from: number; to: number; message: string; severity: 'error' | 'warning'; code: string }
export interface AuthoringSpan { path: number[]; from: number; to: number; contentFrom?: number; contentTo?: number; kind?: 'text' | 'node' | 'attribute'; offsets?: number[]; encoding?: 'json' | 'base64json' }
export interface AuthoringParseResult { document: JSONContent; diagnostics: AuthoringDiagnostic[]; spans: AuthoringSpan[] }
