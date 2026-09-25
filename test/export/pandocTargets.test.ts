import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { documentParser } from '../../src/features/editor-md/documentExtensions';
import { pandocSource } from '../../src/features/export/pandocDocument';

const executable = [process.env.PANDOC_PATH, ...['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'].map(name =>
  process.env[name] && join(process.env[name]!, 'Pandoc', 'pandoc.exe'))].find(path => path && existsSync(path));
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe.skipIf(!executable)('installed Pandoc target behavior', () => {
  it('writes native Word styles, cell properties, dimensions, spans, grid slots and footnotes; writes LaTeX styling commands', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'noteboard-pandoc-target-'));
    try {
      const image = join(directory, 'pixel.png');
      writeFileSync(image, readFileSync(resolve('src-tauri/icons/32x32.png')));
      const styled: JSONContent = { type: 'text', text: 'StyledText', marks: [{ type: 'textColor', attrs: { color: '#0a0b0c' } }, { type: 'highlight', attrs: { color: '#fef08a' } }] };
      const source: JSONContent = { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [{ type: 'text', text: 'AlignedHeading' }] },
        { type: 'paragraph', attrs: { textAlign: 'center', indent: 2 }, content: [styled, { type: 'text', text: ' NoteAnchor', marks: [{ type: 'annotationReference', attrs: { id: 'a' } }] }] },
        { type: 'paragraph', content: [styled] },
        { type: 'imageCollection', attrs: { layout: 'carousel', columns: 2 }, content: [
          { type: 'imageSlot', content: [{ type: 'image', attrs: { src: image, alt: 'SizedImage', width: 96 } }, paragraph('ImageCaption')] },
          { type: 'imageSlot', content: [{ type: 'paragraph' }] },
        ] },
        { type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 2, rowspan: 2, colwidth: [100, 200], background: '#fed7aa', verticalAlign: 'bottom' }, content: [paragraph('MergedContent'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('NestedList')] }] }] },
            { type: 'tableCell', attrs: { colwidth: [100], background: '#bfdbfe', verticalAlign: 'middle' }, content: [paragraph('CellB')] },
          ] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('CellC')] }] },
        ] },
        { type: 'disclosure', attrs: { title: 'DisclosureTitle', open: false }, content: [paragraph('DisclosureBody')] },
        { type: 'annotationStore', content: [{ type: 'annotationBody', attrs: { id: 'a' }, content: [paragraph('FootnoteBody'), { type: 'mathBlock', attrs: { latex: 'x^2' } }] }] },
      ] };
      const ast = JSON.parse(pandocSource(documentParser().schema.nodeFromJSON(source)));
      const template = JSON.parse(execFileSync(executable!, ['--from=markdown', '--to=json'], { input: '', encoding: 'utf8' }));
      ast['pandoc-api-version'] = template['pandoc-api-version'];
      const outputs: Record<string, string> = {};
      for (const target of ['docx', 'latex']) {
        ast.meta['noteboard-target'] = { t: 'MetaString', c: target };
        const output = join(directory, `result.${target}`);
        execFileSync(executable!, ['--from=json', '--standalone', '--wrap=none', '--to', resolve('src-tauri/src/export/pandoc-targets.lua'), '--output', output], { input: JSON.stringify(ast), stdio: ['pipe', 'pipe', 'pipe'] });
        outputs[target] = output;
      }
      const archive = await JSZip.loadAsync(readFileSync(outputs.docx));
      const body = await archive.file('word/document.xml')!.async('string');
      const styles = await archive.file('word/styles.xml')!.async('string');
      const notes = await archive.file('word/footnotes.xml')!.async('string');
      expect(styles).toContain('<w:color w:val="0A0B0C"/>');
      expect(styles.match(/w:fill="FEF08A"/g)).toHaveLength(1); // shared run style
      expect(styles).toContain('<w:jc w:val="center"/>');
      expect(styles).toContain('<w:jc w:val="right"/>');
      expect(styles).toContain('<w:basedOn w:val="Heading2"/>');
      expect(styles).toContain('<w:ind w:left="960"/>');
      expect(body).toContain('w:fill="FED7AA"');
      expect(body).toContain('<w:vAlign w:val="bottom"/>');
      expect(body).toContain('<w:vAlign w:val="center"/>');
      expect(body).toContain('w:fill="BFDBFE"');
      const word = new DOMParser().parseFromString(body, 'application/xml');
      for (const cell of Array.from(word.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'tc'))) {
        expect(Array.from(cell.children).filter(child => child.localName === 'tcPr')).toHaveLength(1);
      }
      expect(body).toContain('<w:gridSpan w:val="2"');
      expect(body).toContain('<w:vMerge w:val="restart"');
      expect(body).toContain('cx="914400" cy="914400"');
      expect(body).toContain('w:footnoteReference');
      expect(notes).toContain('FootnoteBody');
      expect(notes).toContain('m:oMath');
      for (const text of ['MergedContent', 'NestedList', 'CellB', 'CellC', 'ImageCaption', 'DisclosureTitle', 'DisclosureBody']) expect(body).toContain(text);
      expect(body).not.toContain('NBExportCell:');
      expect(body).not.toContain('NBExportTable:');
      expect(body).toMatch(/<w:tblStyle w:val="NBExport\d+"/);
      expect(styles).toContain('w:type="table"');
      const widths = [...body.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(match => Number(match[1]));
      expect(new Set(widths).size).toBeGreaterThan(1);
      const latex = readFileSync(outputs.latex, 'utf8');
      for (const command of ['\\textcolor[HTML]{0A0B0C}', '\\colorbox[HTML]{FEF08A}', '\\begin{center}', '\\begin{flushright}', '\\begin{adjustwidth}{4em}', '\\cellcolor[HTML]{FED7AA}', '\\multirow', '\\multicolumn', '\\footnote{', '\\includegraphics[width=1in']) expect(latex).toContain(command);
      expect(latex).toContain('FootnoteBody');
      expect(latex).toContain('DisclosureBody');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30000);
});
