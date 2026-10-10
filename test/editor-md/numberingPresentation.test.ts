import { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { describe, expect, it, vi } from 'vitest';
import { buildDocumentExtensions, documentParser, parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';
import { createMarkdownLexer } from '../../src/features/editor-md/markdownLexer';
import { serializeMarkdown } from '../../src/features/editor-md/serialize';
import { formatNumbering, NUMBERING_STYLES, normalizeNumberingStyle } from '../../src/features/editor-md/numbering/styles';
import { listItemHorizontalBounds, orderedMarkerText, releaseListMarkerGeometry } from '../../src/features/editor-md/listMarkerGeometry';
import { renderDocument } from '../../src/features/export/renderDocument';

describe('numbering presentation', () => {
  it('formats the same logical ordinal in every supported style', () => {
    expect(NUMBERING_STYLES.map(style => formatNumbering(27, style.value))).toEqual(['27.', '27', '27', '二十七、', '(27)', 'XXVII.', 'xxvii.', 'AA.', 'aa.']);
    expect(normalizeNumberingStyle('unknown')).toBe('decimal');
    expect(normalizeNumberingStyle({ value: 'circle' })).toBe('decimal');
    expect(formatNumbering(123456789, 'circle')).toBe('123456789');
    expect(formatNumbering(123456789, 'box')).toBe('123456789');
  });

  it.each([[1, '一、'], [10, '十、'], [11, '十一、'], [101, '一百零一、'], [110, '一百一十、'], [1001, '一千零一、'], [9999, '九千九百九十九、'], [10000, '10000、']] as const)('formats Chinese ordinal %s', (value, marker) => {
    expect(formatNumbering(value, 'chinese')).toBe(marker);
  });

  it('matches native Roman and alphabetic boundaries without wrapping ordinals', () => {
    expect(formatNumbering(3999, 'upper-roman')).toBe('MMMCMXCIX.');
    expect(formatNumbering(4000, 'lower-roman')).toBe('4000.');
    expect(formatNumbering(702, 'upper-alpha')).toBe('ZZ.');
    expect(formatNumbering(703, 'lower-alpha')).toBe('aaa.');
    expect(formatNumbering(0, 'lower-alpha')).toBe('0.');
    expect(orderedMarkerText(27, 'upper-latin')).toBe('AA. ');
    expect(orderedMarkerText(4, 'decimal-leading-zero')).toBe('04. ');
  });

  it('preserves nested styles and continuation metadata while keeping readable decimal Markdown', async () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<ol start="27" data-number-style="circle"><li><p>outer</p><ol start="3" data-number-style="chinese"><li><p>inner</p></li></ol></li><li><p>last</p></li></ol><p>gap</p><ol start="29" data-number-style="box" data-numbering="continue"><li><p>continued</p></li></ol>' });
    try {
      const markdown = serializeMarkdown(editor);
      expect(markdown).toContain('27. outer');
      expect(markdown).toContain('3. inner');
      expect(markdown).toContain('29. continued');
      expect(markdown).toContain('<!-- noteboard-styles ');
      expect(markdown).not.toContain('<ol');
      expect(parseMarkdownDocument(markdown).toJSON()).toEqual(editor.getJSON());
      for (const mode of ['print', 'html'] as const) {
        const output = await renderDocument(markdown, 'Numbering', '', undefined, undefined, undefined, undefined, mode);
        expect(output.html).toContain('data-number-style="circle"');
        expect(output.html).toContain('data-number-style="chinese"');
        expect(output.html).toContain('data-number-style="box"');
        expect(output.html).toContain('start="29"');
        expect(output.html).not.toContain('noteboard-styles');
      }
    } finally { editor.destroy(); }
  });

  it('leaves native Markdown metadata-free and ignores unsafe or stale list styling', () => {
    const plain = new Editor({ extensions: buildDocumentExtensions(), content: '<ol start="3"><li>one</li></ol>' });
    const styled = new Editor({ extensions: buildDocumentExtensions(), content: '<ol start="3" data-number-style="paren"><li>unique</li></ol>' });
    try {
      expect(serializeMarkdown(plain)).not.toContain('noteboard-styles');
      const markdown = serializeMarkdown(styled);
      const invalid = parseMarkdownDocument(markdown.replace('"numberStyle":"paren"', '"numberStyle":"invalid","numbering":"invalid"'));
      expect(invalid.firstChild?.attrs).toMatchObject({ numberStyle: null, numbering: null, start: 3 });
      const changed = parseMarkdownDocument(markdown.replace('unique', 'changed'));
      expect(changed.firstChild?.attrs).toMatchObject({ numberStyle: null, numbering: null, start: 3 });
    } finally { plain.destroy(); styled.destroy(); }
  });

  it('derives wide layout for editor/export without persisting a presentation cache', async () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<ol start="999999999"><li><p>long ordinal</p></li><li><p></p></li></ol>' });
    try {
      expect(editor.getHTML()).toContain('data-numbering-layout="columns"');
      expect(editor.getHTML()).toContain('counter-reset: list-item 999999998');
      const source = serializeMarkdown(editor);
      expect(source).not.toContain('numbering-layout'); expect(source).not.toContain('counter-reset');
      expect(parseMarkdownDocument(source).toJSON()).toEqual(editor.getJSON());
      const output = await renderDocument(source, 'Long counters', '', undefined, undefined, undefined, undefined, 'html');
      expect(output.html).toContain('data-numbering-layout="columns"');
    } finally { editor.destroy(); }
  });

  it.each(['top', 'nested', 'deep', 'bullet', 'quote'])('preserves adjacent list segments after styling one item (%s)', context => {
    const segments = '<ol><li><p>before</p></li></ol><ol start="2" data-number-style="circle" data-numbering="continue"><li><p>styled</p></li></ol><ol start="3" data-numbering="continue"><li><p>after</p></li></ol><ol data-numbering="restart"><li><p>new group</p></li></ol>';
    const wrappers: Record<string, string> = { top: segments, nested: `<ol><li><p>parent</p>${segments}</li></ol>`, deep: `<ol><li><p>grandparent</p><ol><li><p>parent</p>${segments}</li></ol></li></ol>`, bullet: `<ul><li><p>parent</p>${segments}</li></ul>`, quote: `<blockquote>${segments}</blockquote>` };
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: wrappers[context] });
    try {
      const markdown = serializeMarkdown(editor);
      expect(markdown).toContain('"numbering":"restart"');
      expect(markdown.match(/<!-- noteboard-list-boundary -->/g)).toHaveLength(3);
      const reopened = parseMarkdownDocument(markdown);
      expect(reopened.toJSON(), markdown).toEqual(editor.getJSON());
      expect(documentParser().manager.serialize(reopened.toJSON())).toBe(markdown);
    } finally { editor.destroy(); }
  });

  it('ignores only the exact standalone list boundary and preserves code examples and ordinary comments', () => {
    const lexer = createMarkdownLexer();
    expect(lexer.lexer('<!-- noteboard-list-boundary -->\n')[0].type).toBe('noteboardListBoundary');
    for (const comment of ['<!-- -->', '<!-- user comment -->', '<!-- noteboard-list-boundary extra -->']) expect(lexer.lexer(comment)[0].type).toBe('html');
    const source = '```md\n<!-- noteboard-list-boundary -->\n```';
    expect(parseMarkdownDocument(source).firstChild?.textContent).toBe('<!-- noteboard-list-boundary -->');
    expect(lexer.lexer('prefix <!-- noteboard-list-boundary --> suffix')[0].type).toBe('paragraph');
  });

  it.each(['circle', 'box'])('keeps the %s counter inside the row hit area even when list-style is none', numberStyle => {
    const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' }, orderedList: { content: 'listItem+', group: 'block', attrs: { start: { default: 1 }, numberStyle: { default: null } } }, listItem: { content: 'paragraph+' }, text: { group: 'inline' } } });
    const doc = schema.nodes.doc.create(null, schema.nodes.orderedList.create({ start: 123456, numberStyle }, schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('one')))));
    const view = { state: { doc } } as unknown as EditorView, list = document.createElement('ol'), item = list.appendChild(document.createElement('li'));
    const rect = { left: 88, right: 520 } as DOMRect;
    list.getBoundingClientRect = () => ({ left: 64, right: 520 }) as DOMRect;
    Object.assign(item.style, { fontSize: '16px', listStyleType: 'none' });
    const measureText = vi.fn(() => ({ width: 76 }));
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText } as unknown as CanvasRenderingContext2D);
    try {
      expect(listItemHorizontalBounds(view, 1, item, rect, 1).left).toBeCloseTo(-1.04);
      expect(measureText).toHaveBeenCalledWith('123456');
    } finally { releaseListMarkerGeometry(view); spy.mockRestore(); }
  });
});
