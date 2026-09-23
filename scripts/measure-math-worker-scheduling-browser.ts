// @ts-nocheck -- copied beside the isolated source snapshots by the runner.
import atlas from './atlas.md?raw';
import { readMath, isDisplayMath } from './current/mathSyntax';
import { renderMathMarkup } from './current/mathEngine';
import * as current from './current/mathRendering';
import * as baseline from './baseline/mathRendering';

const entries = [];
const clean = atlas.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)/gm, match => match.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, match => ' '.repeat(match.length));
for (let at = 0; at < clean.length; at++) {
  const match = readMath(clean, at, true);
  if (!match) continue;
  entries.push({ latex: match.latex.trim(), display: isDisplayMath(match.delimiter) }); at = match.end - 1;
}
// Comments change only cache keys: all 466 occurrences render independently,
// including equal source expressions. Direct and worker batches use this input.
const uniqueEntries = entries.map((entry, index) => ({ ...entry, latex: `${entry.latex}\n% scheduler occurrence ${index}` }));
const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { n: values.length, median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) }; };
const checked = value => { if (value.error) throw Error(value.error); return value; };
async function measure(fn, count = 5) { const times = []; for (let iteration = 0; iteration < count; iteration++) { const start = performance.now(); await fn(); times.push(performance.now() - start); } return stats(times); }
async function serial(module) { for (const entry of entries) { module.clearKatexCache(); checked(await module.renderMath(entry.latex, entry.display)); } }
async function concurrent(module) { module.clearKatexCache(); await Promise.all(uniqueEntries.map(entry => module.renderMath(entry.latex, entry.display).then(checked))); }
window.mathWorkerBench = async () => {
  // Warm every engine and chemistry import before measured repetitions.
  for (const entry of uniqueEntries) checked(await renderMathMarkup(entry.latex, entry.display));
  await concurrent(current); await concurrent(baseline);
  const direct = await measure(async () => { for (const entry of uniqueEntries) checked(await renderMathMarkup(entry.latex, entry.display)); });
  const baselineSerial = await measure(() => serial(baseline));
  const currentSerial = await measure(() => serial(current));
  const baselineQueued = await measure(() => concurrent(baseline));
  const currentBatched = await measure(() => concurrent(current));
  return { count: entries.length, direct, baselineSerial, currentSerial, baselineQueued, currentBatched };
};
