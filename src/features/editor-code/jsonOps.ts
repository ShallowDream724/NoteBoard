import type { EditorView } from '@codemirror/view';
import { showToast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LanguageId } from '../../core/ipc/types';
import { formatXml } from './format';
import {
  ANALYSIS_LIMIT_MESSAGE, ANALYSIS_OUTPUT_MAX_CHARS, MANUAL_ANALYSIS_MAX_CHARS,
  SYNC_JSON_MAX_CHARS, XML_MAX_CHARS, expandJsonText, minifyJsonText,
  validateJsonText, validateXmlText,
  type TextAnalysisRequest, type TextAnalysisResult,
} from './textAnalysis';
import { AnalysisCancelled, textAnalysisService } from './textAnalysisService';
import { getAnalysisOwner } from './textAnalysisLifecycle';

export { expandJsonText, minifyJsonText, validateJsonText, extractJsonErrorPosition, type JsonValidationResult } from './textAnalysis';
export { textAnalysisLifecycle } from './textAnalysisLifecycle';

export interface JsonOpOptions {
  scope?: 'all' | 'selection' | 'auto';
  tabSize?: number;
  lang?: LanguageId;
}

/** Size is checked before sliceDoc()/toString(), including explicit selections. */
function getTargetRange(view: EditorView, options: JsonOpOptions | undefined, maximum: number, action: string) {
  const selection = view.state.selection.main;
  if (options?.scope === 'selection' && selection.empty) {
    showToast(`未选择任何文本，请先选中要${action}的片段`, 'warning');
    return null;
  }
  const isSelected = options?.scope !== 'all' && !selection.empty;
  const from = isSelected ? selection.from : 0;
  const to = isSelected ? selection.to : view.state.doc.length;
  if (to - from > maximum) { showToast(ANALYSIS_LIMIT_MESSAGE, 'warning'); return null; }
  const text = isSelected ? view.state.sliceDoc(from, to) : view.state.doc.toString();
  if (!text.trim()) { showToast(`当前${isSelected ? '选中文本' : '全文'}内容为空，无法${action}`, 'warning'); return null; }
  return { from, to, isSelected, text, selection, scopeName: isSelected ? '选中文本' : '全文' };
}

function needsJsonWorker(text: string, operation: TextAnalysisRequest['operation'], tabSize = 2): boolean {
  if (text.length > SYNC_JSON_MAX_CHARS) return true;
  if (operation !== 'expand') return false;
  let quoted = false;
  let depth = 0;
  let estimate = text.length;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if ('{[,}]'.includes(char)) {
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
      estimate += Math.max(0, depth) * tabSize + 2;
      if (depth > 64 || estimate > 128 * 1024) return true;
    }
  }
  return false;
}

function runOperation(view: EditorView, request: Omit<TextAnalysisRequest, 'text'>, options?: JsonOpOptions): boolean {
  const action = request.operation === 'validate' ? '校验' : request.operation === 'minify' ? '压缩' : '展开';
  const target = getTargetRange(view, options, MANUAL_ANALYSIS_MAX_CHARS, action);
  if (!target) return false;
  const owner = getAnalysisOwner(view);
  owner.cancel();
  const revision = owner.revision;
  const document = view.state.doc;
  const selection = view.state.selection;
  const languageName = request.language.toUpperCase();
  const current = () => owner.alive && owner.revision === revision
    && view.state.doc === document && view.state.selection.eq(selection);
  const apply = (result: TextAnalysisResult) => {
    if (!current()) { if (owner.alive) showToast('内容或选区已变化，本次操作已取消', 'info'); return; }
    if (result.error) { showToast(`${languageName} ${action}失败: ${result.error}`, 'error', 4500); return; }
    const firstIssue = result.issues?.[0];
    const validation = firstIssue
      ? { valid: false, error: firstIssue.message, errorPos: firstIssue.from }
      : result.validation ?? { valid: true };
    if (request.operation === 'validate') {
      if (validation.valid) { showToast(`✓ ${languageName} 格式校验通过（${target.scopeName}）`, 'success'); return; }
      showToast(`${languageName} 校验失败（${target.scopeName}）: ${validation.error}`, 'error', 4500);
      const position = Math.min(target.from + (validation.errorPos ?? 0), document.length);
      view.dispatch({ selection: { anchor: position, head: Math.min(position + 1, document.length) }, scrollIntoView: true });
      view.focus();
      return;
    }
    let output = result.output!;
    if (request.operation === 'expand' && !target.isSelected) {
      if (output.length >= ANALYSIS_OUTPUT_MAX_CHARS) { showToast(ANALYSIS_LIMIT_MESSAGE, 'warning'); return; }
      output += '\n';
    }
    if (output === view.state.sliceDoc(target.from, target.to)) {
      showToast(`${languageName} 已经是${request.operation === 'minify' ? '压缩' : '展开'}状态（${target.scopeName}）`, 'info'); return;
    }
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: output },
      selection: target.isSelected ? { anchor: target.from, head: target.from + output.length }
        : { anchor: Math.min(target.selection.anchor, output.length) },
      scrollIntoView: true,
    });
    view.focus();
    showToast(`✓ ${languageName} ${action}成功（${target.scopeName}）`, 'success');
  };
  if (request.language === 'json' && !needsJsonWorker(target.text, request.operation, request.tabSize)) {
    try {
      apply(request.operation === 'validate' ? { validation: validateJsonText(target.text) }
        : { output: request.operation === 'minify' ? minifyJsonText(target.text) : expandJsonText(target.text, request.tabSize) });
      return true;
    } catch (error) {
      showToast(`${languageName} ${action}失败: ${error instanceof Error ? error.message : String(error)}`, 'error', 4500);
      return false;
    }
  }
  showToast(`正在后台${action} ${languageName}（${target.scopeName}）`, 'info');
  const text = target.text;
  target.text = '';
  void textAnalysisService.request(owner, { ...request, text }).then(apply).catch(error => {
    if (!owner.alive) return;
    showToast(error instanceof AnalysisCancelled ? error.message
      : `${languageName} ${action}失败: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof AnalysisCancelled ? 'info' : 'error', 4500);
  });
  return true;
}

export function handleValidateJson(view: EditorView, options?: JsonOpOptions): boolean {
  return runOperation(view, { language: 'json', operation: 'validate' }, options);
}
export function handleMinifyJson(view: EditorView, options?: JsonOpOptions): boolean {
  if (options?.lang && options.lang !== 'json' && options.lang !== 'markdown') return false;
  return runOperation(view, { language: 'json', operation: 'minify' }, options);
}
export function handleExpandJson(view: EditorView, langOrOptions?: LanguageId | JsonOpOptions): boolean {
  const options = typeof langOrOptions === 'string' ? { lang: langOrOptions } : langOrOptions;
  if (options?.lang === 'xml') return handleFormatXml(view, options);
  if (options?.lang && options.lang !== 'json' && options.lang !== 'markdown') return false;
  return runOperation(view, {
    language: 'json', operation: 'expand',
    tabSize: options?.tabSize ?? useSettingsStore.getState().settings.editor.tabSize ?? 2,
  }, options);
}

export function handleFormatXml(view: EditorView, options?: JsonOpOptions): boolean {
  const target = getTargetRange(view, options, XML_MAX_CHARS, '格式化');
  if (!target) return false;
  getAnalysisOwner(view).cancel();
  try {
    const output = formatXml(target.text);
    if (output !== target.text) {
      view.dispatch({ changes: { from: target.from, to: target.to, insert: output },
        selection: target.isSelected ? { anchor: target.from, head: target.from + output.length }
          : { anchor: Math.min(target.selection.anchor, output.length) }, scrollIntoView: true });
      view.focus();
    }
    showToast(`✓ XML 格式化成功（${target.scopeName}）`, 'success');
    return true;
  } catch (error) {
    showToast(`XML 格式化失败: ${error instanceof Error ? error.message : String(error)}`, 'error', 4500);
    return false;
  }
}

export function validateTextLanguage(view: EditorView, lang: LanguageId, options?: JsonOpOptions): boolean {
  if (lang === 'json' || lang === 'yaml') return runOperation(view, { language: lang, operation: 'validate' }, options);
  if (lang !== 'xml') return false;
  const target = getTargetRange(view, options, XML_MAX_CHARS, '校验');
  if (!target) return false;
  getAnalysisOwner(view).cancel();
  const result = validateXmlText(target.text);
  if (result.unsupported) { showToast(result.error ?? '此 XML 请使用外部校验工具', 'warning'); return false; }
  if (result.valid) showToast(`✓ XML 格式校验通过（${target.scopeName}）`, 'success');
  else {
    showToast(`XML 校验失败（${target.scopeName}）: ${result.error}`, 'error', 4500);
    const position = target.from + (result.errorPos ?? 0);
    view.dispatch({ selection: { anchor: position, head: Math.min(position + 1, view.state.doc.length) }, scrollIntoView: true });
    view.focus();
  }
  return true;
}
