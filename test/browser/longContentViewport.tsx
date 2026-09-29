import React from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '../../src/components/Tooltip';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { parseEditorDocument, serializeEditorDocument } from '../../src/features/editor-md/editorDocumentCodec';
import { tableViewportKey } from '../../src/features/editor-md/tableViewport';
import { setDocumentFormulaReadingMode, setDocumentTableReadingMode, type FormulaReadingMode, type TableReadingMode } from '../../src/features/editor-md/documentReadingView';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { BlockContextMenu } from '../../src/features/editor-md/BlockContextMenu';
import { applyTheme, applyTypography } from '../../src/core/theme/applyTheme';
import { useSettingsStore } from '../../src/stores/settingsStore';
import '../../src/styles/globals.css';
import '../../src/components/appShell.css';
import '../../src/features/outline/outlinePanel.css';

const key = 'untitled:long-content-viewport';
applyTheme('chen-guang'); applyTypography(useSettingsStore.getState().settings.typography);
useDocumentStore.getState().upsertFromPayload({ key, displayName: '压力文档.md', dirPath: '', kind: 'markdown', language: 'markdown', content: '# 压力文档', encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
useWindowStore.getState().openTab({ key, displayName: '压力文档.md', path: null, kind: 'markdown', language: 'markdown', isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
const style = document.createElement('style');
style.textContent = 'html,body,#root{margin:0;width:100%;height:100%} .nb-document-stage{position:relative;height:100%;} .nb-editor-area{height:100%}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<TooltipProvider><div className="nb-editor-area"><div className="nb-document-stage" data-outline><TipTapEditor docKey={key}/><nav className="nb-document-outline"><button type="button" className="nb-outline-toggle" aria-label="关闭大纲" onClick={() => document.querySelector('.nb-document-stage')?.removeAttribute('data-outline')}>»</button><div>千行观测表</div><div>30 列宽表</div></nav></div></div></TooltipProvider>);
const menu = document.createElement('aside'); menu.style.cssText = 'position:fixed;top:10px;left:10px;z-index:1600'; document.body.append(menu);
const menuRoot = createRoot(menu);
const cycleKey = new PluginKey('viewport-test-cycle');
let contentTransactions = 0;
const qa = {
  ready: () => !!getMdTipTapEditor(key),
  load: (source: string) => { const editor = getMdTipTapEditor(key)!; parseEditorDocument(editor, source); contentTransactions = 0; editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) contentTransactions++; }); },
  editor: () => getMdTipTapEditor(key)!,
  reading: (formula: FormulaReadingMode, table: TableReadingMode = 'expand') => { const editor = getMdTipTapEditor(key)!; setDocumentFormulaReadingMode(editor, formula); setDocumentTableReadingMode(editor, table); },
  source: () => serializeEditorDocument(getMdTipTapEditor(key)!),
  contentTransactions: () => contentTransactions,
  tablePositions: () => { const values: number[] = []; getMdTipTapEditor(key)!.state.doc.descendants((node, pos) => { if (node.type.name === 'table') values.push(pos); }); return values; },
  visibleState: () => [...tableViewportKey.getState(getMdTipTapEditor(key)!.state)!.rows.values()].filter(row => row.visible).length,
  reconfigure: () => { const editor = getMdTipTapEditor(key)!; editor.unregisterPlugin(cycleKey); editor.registerPlugin(new Plugin({ key: cycleKey })); },
  showMenu: (pos: number) => menuRoot.render(<TooltipProvider><BlockContextMenu editor={getMdTipTapEditor(key)!} pos={pos} close={() => menuRoot.render(null)}/></TooltipProvider>),
  outline: (shown: boolean) => { document.querySelector('.nb-document-stage')?.toggleAttribute('data-outline', shown); (document.querySelector('.nb-document-outline') as HTMLElement).style.display = shown ? '' : 'none'; },
};
declare global { interface Window { longContentQA: typeof qa } }
window.longContentQA = qa;
