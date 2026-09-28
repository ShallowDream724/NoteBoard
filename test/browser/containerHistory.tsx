import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '../../src/components/Tooltip';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { diagramContent } from '../../src/features/editor-md/insertContentRecipes';
import { encodeNativeDocument, type NativeNode } from '../../src/core/nativeDocument';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import '../../src/styles/globals.css';

const host = document.getElementById('root')!;
host.style.cssText = 'width:850px;height:750px;margin:20px auto;position:relative';
let root: Root | null = null;
let currentKey = '';
let sequence = 0;

function currentEditor() {
  const editor = getMdTipTapEditor(currentKey);
  if (!editor) throw new Error('Visual editor is not ready');
  return editor;
}

const qa = {
  mount(blocks: NativeNode[]) {
    root?.unmount();
    currentKey = `untitled:container-history-browser-${++sequence}`;
    const key = currentKey;
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'container-history.nb', dirPath: '', kind: 'noteboard', language: 'markdown',
      content: encodeNativeDocument({ type: 'doc', content: blocks }), encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
    useWindowStore.getState().openTab({ key, displayName: 'container-history.nb', path: null, kind: 'noteboard', language: 'markdown',
      isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
    root = createRoot(host);
    root.render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>);
    return key;
  },
  ready() { return !!getMdTipTapEditor(currentKey); },
  focusFirstParagraphEnd() {
    const editor = currentEditor();
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    editor.view.focus();
  },
  insertCode() {
    const editor = currentEditor();
    editor.chain().focus('end').insertContent({ type: 'codeBlock', attrs: { language: 'text' } }).run();
    this.focusCode();
  },
  focusCode() {
    const editor = currentEditor();
    let position = -1;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') { position = pos; return false; } });
    if (position < 0) throw new Error('No code block');
    editor.commands.setTextSelection(position + 1);
    editor.view.focus();
  },
  insertMermaid() {
    currentEditor().chain().focus('end').insertContent(diagramContent('mermaid')).run();
  },
  state() {
    const editor = currentEditor();
    const code: string[] = [], mermaid: string[] = [];
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mermaid 图表源码"]');
    editor.state.doc.descendants(node => {
      if (node.type.name === 'codeBlock') code.push(node.textContent);
      if (node.type.name === 'mermaidBlock') mermaid.push(String(node.attrs.code));
    });
    return { text: editor.state.doc.firstChild?.textContent ?? '', code, mermaid,
      sourceOpen: !!source && !host.querySelector('.nb-diagram-container'),
      sourceFocused: !!source && document.activeElement === source };
  },
};

declare global { interface Window { containerHistoryQA: typeof qa } }
window.containerHistoryQA = qa;
