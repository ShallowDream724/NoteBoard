import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LanguageId } from '../../core/ipc/types';
import { AUTO_ANALYSIS_MAX_CHARS, SYNC_JSON_MAX_CHARS, XML_MAX_CHARS, validateJsonText, validateXmlText } from './textAnalysis';
import { AnalysisCancelled, textAnalysisService } from './textAnalysisService';
import { getAnalysisOwner, textAnalysisLifecycle } from './textAnalysisLifecycle';

export async function lintTextLanguage(view: EditorView, language: 'json' | 'yaml' | 'xml'): Promise<Diagnostic[]> {
  const maximum = language === 'xml' ? XML_MAX_CHARS : AUTO_ANALYSIS_MAX_CHARS;
  if (view.state.doc.length > maximum) return [];
  const document = view.state.doc;
  const owner = getAnalysisOwner(view);
  const revision = owner.revision;
  const text = document.toString();
  if (!text.trim()) return [];
  try {
    const result = language === 'xml'
      ? { validation: validateXmlText(text) }
      : language === 'json' && text.length <= SYNC_JSON_MAX_CHARS
        ? { validation: validateJsonText(text) }
        : await textAnalysisService.request(owner.lintOwner, { language, operation: 'validate', text }, 'automatic');
    if (!owner.alive || owner.revision !== revision || view.state.doc !== document) return [];
    if (result.error) return [];
    if (result.issues) return result.issues.map(issue => ({ ...issue, severity: 'error' as const }));
    if (result.validation && !result.validation.valid) {
      if (result.validation.unsupported) return [];
      const from = result.validation.errorPos ?? 0;
      return [{ from, to: Math.min(from + 1, text.length), severity: 'error', message: result.validation.error ?? '语法错误' }];
    }
  } catch (error) {
    if (!(error instanceof AnalysisCancelled)) console.warn('后台语法检查暂不可用', error);
  }
  return [];
}

export function getLinterForLanguage(lang: LanguageId): Extension | null {
  if (lang !== 'json' && lang !== 'yaml' && lang !== 'xml') return null;
  return [textAnalysisLifecycle, linter(view => lintTextLanguage(view, lang), { delay: 500 })];
}
