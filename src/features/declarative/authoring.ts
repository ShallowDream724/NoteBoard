import { documentParser } from '../editor-md/documentExtensions';
import { parseAuthoringWith } from './codec';
import type { AuthoringParseResult } from './types';
export type { AuthoringDiagnostic, AuthoringSpan, AuthoringParseResult } from './types';
export { installAuthoringCodec, parseAuthoringWith, serializeAuthoring, serializeAuthoringJSON, rememberAuthoringSource, inheritAuthoringSource, hasAuthoringSource } from './codec';
export function parseAuthoring(source: string): AuthoringParseResult { const { manager, schema } = documentParser(); return parseAuthoringWith(source, manager, schema); }
