// Copied beside the installed-version source snapshot by the Node runner.
// @ts-nocheck
import atlas from './atlas.md?raw';
import { readMath, isDisplayMath } from './baseline/mathSyntax';
import { renderMathMarkup } from './baseline/mathEngine';
import { renderMath, clearKatexCache } from './baseline/mathRendering';
import { queueMath } from './baseline/mathRenderQueue';
import 'katex/dist/katex.min.css';
import MarkdownIt from 'markdown-it';
const root = document.querySelector('#content');
document.head.insertAdjacentHTML('beforeend', `<style>body{margin:0;font:16px/1.65 Arial,sans-serif;color:#172033}#content{box-sizing:border-box;width:1000px;max-width:100%;padding:24px 64px}p{margin:12px 0}.display{display:block;margin:20px 0}.inline{display:inline-block}.math-preview{display:inline-block;width:max-content}.display .math-preview{min-width:100%}h3{font-size:22px;margin:24px 0 12px}pre{font:14px/1.5 monospace;background:#f6f8fa;padding:12px;white-space:pre-wrap}.katex-display{margin:1em 0}</style>`);
const entries = [];
// Atlas is a deliberately regular fixture. Exclude fenced code and inline code,
// then use the exact production delimiter reader (rather than a loose regexp).
const fenced = atlas.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)/gm, match => match.replace(/[^\n]/g, ' '));
const clean = fenced.replace(/`[^`\n]*`/g, match => ' '.repeat(match.length));
for (let at = 0; at < clean.length; at++) {
    const match = readMath(clean, at, true);
    if (!match)
        continue;
    const before = clean.slice(0, at);
    const headings = [...before.matchAll(/^### (M\d+) (.+)$/gm)];
    const heading = headings.at(-1);
    entries.push({ latex: match.latex.trim(), display: isDisplayMath(match.delimiter), id: heading?.[1] ?? 'boundary', title: heading?.[2], line: before.split('\n').length, start: match.start, end: match.end });
    at = match.end - 1;
}
const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { n: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], min: sorted[0], max: sorted.at(-1) }; };
const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
const nextPaint = async () => { await tick(); await tick(); };
async function repeat(fn, n) { const times = []; for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
} return stats(times); }
async function generate(items) { const t = performance.now(), html = []; for (const e of items) {
    const value = await renderMathMarkup(e.latex, e.display);
    if (value.error)
        throw Error(e.id + ': ' + value.error);
    html.push(value.html);
} return { ms: performance.now() - t, html }; }
function fill(items, markup) {
    const fragment = document.createDocumentFragment();
    items.forEach((entry, i) => {
        const row = document.createElement(entry.display ? 'div' : 'p');
        row.className = entry.display ? 'display' : 'inline-row';
        const span = document.createElement('span');
        span.className = 'math-preview';
        span.innerHTML = markup[i];
        if (!entry.display)
            row.append(document.createTextNode('行内公式：前文 '));
        row.append(span);
        if (!entry.display)
            row.append(document.createTextNode(' 后文。'));
        fragment.append(row);
    });
    root.replaceChildren(fragment);
}
async function domCost(items, markup, count, documentHtml) {
    const insert = [], layout = [], paintOpportunity = [], total = [];
    for (let i = 0; i < count; i++) {
        root.replaceChildren();
        root.offsetHeight;
        await tick();
        const start = performance.now();
        if (documentHtml)
            root.innerHTML = documentHtml;
        else
            fill(items, markup);
        const built = performance.now();
        root.offsetHeight;
        const laid = performance.now();
        await nextPaint();
        const end = performance.now();
        insert.push(built - start);
        layout.push(laid - built);
        paintOpportunity.push(end - laid);
        total.push(end - start);
    }
    return { insert: stats(insert), layout: stats(layout), cpu: stats(insert.map((value, i) => value + layout[i])), frameWait: stats(paintOpportunity), endToNextPaintOpportunity: stats(total), elements: root.querySelectorAll('*').length, height: root.offsetHeight, width: root.clientWidth };
}
async function pipeline(items, kind) {
    clearKatexCache();
    root.replaceChildren();
    const start = performance.now();
    let complete = 0;
    let compute = 0;
    if (kind === 'serial') {
        for (const e of items) {
            clearKatexCache();
            const t = performance.now();
            await renderMath(e.latex, e.display);
            compute += performance.now() - t;
        }
        return { ms: performance.now() - start };
    }
    const frameGaps = [], longFrames = [];
    let active = true, last;
    const track = t => { if (last !== undefined)
        frameGaps.push(t - last); last = t; if (active)
        requestAnimationFrame(track); };
    requestAnimationFrame(track);
    const observer = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame') ? new PerformanceObserver(list => longFrames.push(...list.getEntries().map(e => ({ duration: e.duration, blockingDuration: e.blockingDuration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, startTime: e.startTime })))) : undefined;
    observer?.observe({ type: 'long-animation-frame' });
    const hosts = items.map(e => { const host = document.createElement(e.display ? 'div' : 'p'); root.append(host); return host; });
    await new Promise(resolve => items.forEach((e, i) => queueMath(`bench-${start}-${i}`, { latex: e.latex, display: e.display, done: result => { hosts[i].innerHTML = result.html; if (++complete === items.length)
            resolve(); } })));
    root.offsetHeight;
    active = false;
    observer?.disconnect();
    return { ms: performance.now() - start, elements: root.querySelectorAll('*').length, frameGaps: stats(frameGaps), longFrames };
}
function documentMarkup(items, html, start = 0, end = atlas.length) {
    let text = '', at = start;
    items.forEach((entry, i) => { text += atlas.slice(at, entry.start) + `<span class="${entry.display ? 'display' : 'inline'}">${html[i]}</span>`; at = entry.end; });
    text += atlas.slice(at, end);
    return new MarkdownIt({ html: true }).render(text);
}
async function run() {
    const coldStart = performance.now();
    const coldResult = await renderMathMarkup('E=mc^2', true);
    const cold = performance.now() - coldStart;
    if (coldResult.error)
        throw Error(coldResult.error);
    const workerColdStart = performance.now();
    clearKatexCache();
    await renderMath('E=mc^2', true);
    const coldWorker = performance.now() - workerColdStart;
    const workerSimple = await repeat(async () => { clearKatexCache(); await renderMath('E=mc^2', true); }, 50);
    const all = await generate(entries);
    const coldDomStart = performance.now();
    fill(entries, all.html);
    const coldDomBuilt = performance.now();
    root.offsetHeight;
    const coldDomLayout = performance.now();
    await document.fonts.ready;
    root.offsetHeight;
    const coldFontsDone = performance.now();
    await nextPaint();
    // Two consecutive real cases, with their code and prose, are a reproducible
    // viewport-sized slice. This is not an A4 PDF page.
    const sample = entries.filter(e => e.id === 'M024' || e.id === 'M025');
    const complex = entries.find(e => e.id === 'M069' && e.display);
    const simple = { latex: 'E=mc^2', display: true };
    const extra = { latex: 'L=' + Array.from({ length: 18 }, (_, i) => `\\lambda_{${i + 1}}\\frac{\\lVert A_{${i + 1}}\\theta-b_{${i + 1}}\\rVert_2^2}{1+\\exp(-\\alpha_{${i + 1}})}`).join('+'), display: true };
    const base = { userAgent: navigator.userAgent, crossOriginIsolated, viewport: [innerWidth, innerHeight], count: entries.length, inline: entries.filter(e => !e.display).length, display: entries.filter(e => e.display).length, unique: new Set(entries.map(e => e.display + ':' + e.latex)).size, coldModuleAndSimpleMs: cold, coldWorkerSimpleMs: coldWorker, firstWholeAtlasMs: all.ms, coldAllDom: { insert: coldDomBuilt - coldDomStart, layout: coldDomLayout - coldDomBuilt, fontReadyAndRelayout: coldFontsDone - coldDomLayout }, allMarkupCharacters: all.html.reduce((a, s) => a + s.length, 0) };
    const simpleHtml = (await generate([simple])).html, complexHtml = (await generate([complex])).html, extraHtml = (await generate([extra])).html, sampleHtml = (await generate(sample)).html;
    const pageHtml = documentMarkup(sample, sampleHtml, atlas.indexOf('### M024'), atlas.indexOf('### M026'));
    const result = { ...base, simple: { source: simple.latex, compute: await repeat(() => renderMathMarkup(simple.latex, true), 200), dom: await domCost([simple], simpleHtml, 20) }, complex: { source: complex.latex, compute: await repeat(() => renderMathMarkup(complex.latex, true), 200), dom: await domCost([complex], complexHtml, 20) }, longFormula: { source: extra.latex, compute: await repeat(() => renderMathMarkup(extra.latex, true), 50), dom: await domCost([extra], extraHtml, 10) }, page: { entries: sample, compute: await repeat(() => generate(sample), 50), dom: await domCost(sample, sampleHtml, 10, pageHtml) }, all: { compute: await repeat(() => generate(entries), 10), dom: await domCost(entries, all.html, 5) } };
    // Actual installed-version worker scheduler, result cache cleared on EVERY call.
    result.uncachedWorkerScheduler = { simple: workerSimple, all: await pipeline(entries, 'serial') };
    // Separately labelled production queue, with normal identical-expression
    // coalescing: measures its frame budget, never used as the pure-render number.
    result.productionQueue = { page: await pipeline(sample, 'queue'), all: await pipeline(entries, 'queue') };
    result.fullDocument = { dom: await domCost(entries, all.html, 3, documentMarkup(entries, all.html)) };
    root.replaceChildren();
    return result;
}
window.mathBench = { run };
