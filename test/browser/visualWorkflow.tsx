import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { TooltipProvider } from '../../src/components/Tooltip';
import { StatusBar } from '../../src/components/statusbar/StatusBar';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { EditorToolbar } from '../../src/features/toolbar/EditorToolbar';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { encodeNativeDocument, type NativeNode } from '../../src/core/nativeDocument';
import { applyTheme, applyTypography } from '../../src/core/theme/applyTheme';
import type { ThemeId } from '../../src/core/ipc/types';
import { serializeNativeNode, serializeEditorDocument, parseEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { emit } from '../../src/core/emitter';
import { initializeDocumentHistory } from '../../src/features/history/documentHistory';
import { discardPendingVisualSnapshot, discardPendingSourceSnapshot } from '../../src/features/editor-md/visualSnapshot';
import '../../src/styles/globals.css';

const key = 'untitled:visual-workflow';
const query = new URLSearchParams(location.search);
const kind = query.get('kind') === 'markdown' ? 'markdown' : 'noteboard';
const theme = (query.get('theme') || 'chen-guang') as ThemeId;
applyTheme(theme); applyTypography(useSettingsStore.getState().settings.typography);
const source = kind === 'noteboard' ? encodeNativeDocument({ type: 'doc', content: [{ type: 'paragraph' }] }) : 'Markdown 正文';
useDocumentStore.getState().upsertFromPayload({ key, displayName: '可视化编辑验收', dirPath: '', kind, language: 'markdown', content: source, encoding: 'utf8', eol: 'lf', size: source.length, mtime: 0, readonly: false });
useWindowStore.getState().openTab({ key, displayName: '可视化编辑验收', path: null, kind, language: 'markdown', isDirty: false, isPreview: false, viewMode: query.has('source') ? 'source' : 'visual', externalStatus: null, isDetached: false });
document.body.style.cssText = 'margin:0;height:100vh;background:var(--editor-bg)';
document.getElementById('root')!.style.height = '100%';
function Workflow() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const tab = useWindowStore(s => s.getTab(key));
  return <TooltipProvider><div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <EditorToolbar activeTab={tab ?? null} activeEditor={editor}/>
    <div style={{ minHeight: 0, flex: 1 }}><TipTapEditor docKey={key} onEditorReady={setEditor}/></div>
    <StatusBar/>
  </div></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Workflow/>);
function loadRaw(content: string): void {
  discardPendingVisualSnapshot(key); discardPendingSourceSnapshot(key);
  parseEditorDocument(getMdTipTapEditor(key)!, content);
  useDocumentStore.getState().setContent(key, content);
  initializeDocumentHistory(key, content, 'visual');
}
const qa = {
  ready: () => !!getMdTipTapEditor(key),
  editor: () => getMdTipTapEditor(key)!,
  state: () => getMdTipTapEditor(key)!.getJSON(),
  source: () => serializeNativeNode(getMdTipTapEditor(key)!.state.doc),
  serialized: () => serializeEditorDocument(getMdTipTapEditor(key)!),
  loadRaw,
  mode: () => useWindowStore.getState().getTab(key)?.viewMode,
  exportHtml: async () => {
    const { renderDocument } = await import('../../src/features/export/renderDocument');
    const { standaloneHtml } = await import('../../src/features/export/standaloneHtml');
    const result = await renderDocument('', '可视化工作流验收', '', undefined, getMdTipTapEditor(key)!.state.doc, undefined, undefined, 'html');
    return standaloneHtml(result.html, '可视化工作流验收');
  },
  exportPdfPayload: async () => {
    const { renderDocument } = await import('../../src/features/export/renderDocument');
    const { DEFAULT_PDF } = await import('../../src/features/export/model');
    const { exportFontCss } = await import('../../src/features/export/capture');
    const result = await renderDocument('', '可视化工作流验收', '', undefined, getMdTipTapEditor(key)!.state.doc);
    return { title: result.title, html: result.html, options: DEFAULT_PDF, fontCss: exportFontCss() };
  },
  requestSource: () => emit('toggle-md-view-mode', { key, mode: 'source' }),
  load: (content: NativeNode[]) => loadRaw(encodeNativeDocument({ type: 'doc', content })),
};
declare global { interface Window { visualWorkflowQA: typeof qa } }
window.visualWorkflowQA = qa;
