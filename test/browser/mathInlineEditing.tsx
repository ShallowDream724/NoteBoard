import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '../../src/components/Tooltip';
import { TipTapEditor } from '../../src/features/editor-md/TipTapEditor';
import { getMdTipTapEditor } from '../../src/features/editor-md/editorInstances';
import { encodeNativeDocument, type NativeNode } from '../../src/core/nativeDocument';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useWindowStore } from '../../src/stores/windowStore';
import '../../src/styles/globals.css';
import { insertMath } from '../../src/features/editor-md/insertMath';

const host = document.getElementById('root')!;
host.style.cssText = 'width:min(720px,calc(100vw - 32px));height:600px;margin:20px auto;position:relative';
let root: Root | undefined, key = '', sequence = 0, updates = 0;
const current = () => getMdTipTapEditor(key)!;
const qa = {
  mount(content: NativeNode[]) {
    root?.unmount();
    key = `untitled:math-inline-browser-${++sequence}`;
    useDocumentStore.getState().upsertFromPayload({ key, displayName: 'inline-math.nb', dirPath: '', kind: 'noteboard', language: 'markdown',
      content: encodeNativeDocument({ type: 'doc', content }), encoding: 'utf8', eol: 'lf', size: 0, mtime: 0, readonly: false });
    useWindowStore.getState().openTab({ key, displayName: 'inline-math.nb', path: null, kind: 'noteboard', language: 'markdown',
      isDirty: false, isPreview: false, viewMode: 'visual', externalStatus: null, isDetached: false });
    root = createRoot(host); root.render(<TooltipProvider><TipTapEditor docKey={key}/></TooltipProvider>);
  },
  ready: () => !!current(),
  focus(position: number) { current().commands.setTextSelection(position); current().view.focus(); },
  insertInline() { insertMath(current(), 'inline'); },
  watchUpdates() { updates = 0; current().on('update', () => updates++); },
  state() {
    const formulas: string[] = [];
    current().state.doc.descendants(node => { if (['mathInline', 'mathBlock'].includes(node.type.name)) formulas.push(node.attrs.latex); });
    return { formulas, text: current().state.doc.textContent, updates };
  },
};
declare global { interface Window { mathInlineEditingQA: typeof qa } }
window.mathInlineEditingQA = qa;
