import React from 'react';
import { createRoot } from 'react-dom/client';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { TooltipProvider } from '../../src/components/Tooltip';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { getMdTipTapEditor, getMdSourceView } from '../../src/features/editor-md/editorInstances';
import { parseEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { encodeNativeDocument } from '../../src/core/nativeDocument';
import { emit } from '../../src/core/emitter';
import { applyTheme, applyTypography } from '../../src/core/theme/applyTheme';
import '../../src/styles/globals.css';

const native = new URLSearchParams(location.search).has('native');
const key = 'untitled:cjk-formatting';
const content = (source: string) => native ? encodeNativeDocument(parseMarkdownDocument(source).toJSON()) : source;
const kind = native ? 'noteboard' : 'markdown';
const displayName = native ? '输入验证.nb' : '输入验证.md';
const initial = new URLSearchParams(location.search).has('stress')
  ? Array.from({ length: 1000 }, (_, i) => `${i} 所以，**得到两种分子。**这就是来源。 ~~删除。~~下一句。`).join('\n\n') : '输入验证';
applyTheme('chen-guang'); applyTypography(useSettingsStore.getState().settings.typography);
useDocumentStore.getState().upsertFromPayload({ key, displayName, dirPath: '', kind, language: 'markdown', content: content(initial), encoding: 'utf8', eol: 'lf', size: initial.length, mtime: 0, readonly: false });
useWindowStore.getState().openTab({ key, displayName, path: null, kind, language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
document.body.style.cssText = 'margin:0;height:100vh';
document.getElementById('root')!.style.height = '100%';
createRoot(document.getElementById('root')!).render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>);
Object.assign(window, { cjkQA: {
  ready: () => !!getMdTipTapEditor(key),
  editor: () => getMdTipTapEditor(key)!,
  load(source: string) { parseEditorDocument(getMdTipTapEditor(key)!, content(source)); },
  mode(mode: 'source' | 'visual') { emit('toggle-md-view-mode', { key, mode }); },
  syntax() { const view = getMdSourceView(key)!; ensureSyntaxTree(view.state, view.state.doc.length, 1000); return syntaxTree(view.state).toString(); },
} });
