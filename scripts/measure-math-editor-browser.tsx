// @ts-nocheck
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, EditorContent } from '@tiptap/react';
import { buildExtensions } from './src/features/editor-md/extensions';
import { parseMarkdown } from './src/features/editor-md/serialize';
import { TooltipProvider } from './src/components/Tooltip';
import './src/styles/globals.css';
import 'katex/dist/katex.min.css';
const host = document.querySelector('#root');
host.style.cssText = 'width:1000px;height:950px;overflow:auto;padding:24px 64px;margin:0';
let editor;
const frame = () => new Promise(r => requestAnimationFrame(r));
window.editorBench = { async mount(markdown) { const start = performance.now(); editor = new Editor({ extensions: buildExtensions(), content: '' }); const created = performance.now(); parseMarkdown(editor, markdown); const parsed = performance.now(); createRoot(host).render(<TooltipProvider><EditorContent editor={editor}/></TooltipProvider>); await frame(); await frame(); return { create: created - start, parse: parsed - created, reactUntilTwoFrames: performance.now() - parsed, mathNodes: host.querySelectorAll('.math-node').length, docNodes: editor.state.doc.nodeSize }; }, async scroll() { await document.fonts.ready; const gaps = [], longFrames = [], tasks = []; const stats = a => { a.sort((x, y) => x - y); return { n: a.length, p50: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], max: a.at(-1), over33: a.filter(x => x > 33).length, over50: a.filter(x => x > 50).length }; }; const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration))); observer.observe({ type: 'longtask' }); const lof = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') ? new PerformanceObserver(list => longFrames.push(...list.getEntries().map(e => ({ duration: e.duration, blocking: e.blockingDuration, styleAndLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0 })))) : undefined; lof?.observe({ type: 'long-animation-frame' }); let transactions = 0; editor.on('transaction', ({ transaction }) => { if (transaction.docChanged)
        transactions++; }); const start = performance.now(); let previous = await frame(); const startHeight = host.scrollHeight; for (let pass = 0; pass < 2; pass++) {
        for (let step = 0; step < 100; step++) {
            host.scrollTop = pass ? host.scrollHeight * (1 - step / 100) : host.scrollHeight * step / 100;
            const now = await frame();
            gaps.push(now - previous);
            previous = now;
        }
    } observer.disconnect(); lof?.disconnect(); return { ms: performance.now() - start, gaps: stats(gaps), tasks, longFrames, transactions, startHeight, endHeight: host.scrollHeight, mountedFormulaCount: host.querySelectorAll('.math-preview .katex').length, elements: host.querySelectorAll('*').length }; } };
