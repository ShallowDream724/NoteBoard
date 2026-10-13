// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { DOMParser, Node } from '@tiptap/pm/model';
import { contrastRatio } from '../../src/core/theme/contrast';
import { darkBackground, readableInk, readableInkVariables } from '../../src/features/document-style/readableInk';
import { BACKGROUND_COLORS, TEXT_COLORS } from '../../src/features/document-style/colors';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { NodeAttributesStep } from '../../src/features/editor-md/nodeAttributesStep';
import { renderFigureCaption } from '../../src/features/editor-md/figureCaption';
import { createReadableInkPlugin } from '../../src/features/document-style/readableInkPlugin';
import { TableColumnWidthsStep } from '../../src/features/editor-md/tableColumnWidths';
import { TablePresentationStep } from '../../src/features/editor-md/tablePresentationCommands';

const editors: Editor[] = [];
const text = (value: string, marks: NonNullable<JSONContent['marks']> = []): JSONContent => ({ type: 'text', text: value, marks });
const p = (value: string, marks: NonNullable<JSONContent['marks']> = []): JSONContent => ({ type: 'paragraph', content: [text(value, marks)] });
const mark = (color = '#fef08a') => ({ type: 'highlight', attrs: { color } });
const ink = (color: string) => ({ type: 'textColor', attrs: { color } });
const create = (content: object[]) => {
  const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content }, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
};
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); vi.restoreAllMocks(); });

describe('theme-safe authored text colors', () => {
  it('keeps readable original colors and gives every palette pair at least 4.5:1', () => {
    expect(readableInk('#2563eb', '#ffffff')).toBe('#2563eb');
    for (const background of BACKGROUND_COLORS.filter(item => item.color)) {
      for (const color of ['#ffffff', ...TEXT_COLORS.map(item => item.color).filter(Boolean)] as string[]) {
        expect(contrastRatio(readableInk(color, background.color!), background.color!), `${color}/${background.color}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(readableInkVariables(color, background.color)['--nb-ink-dark'], darkBackground(background.color!))).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const color of TEXT_COLORS.map(item => item.color).filter(Boolean) as string[]) {
      expect(contrastRatio(readableInkVariables(color)['--nb-ink-dark'], '#0f172a')).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('corrects plain highlight, colored highlight, inline code and table contents without changing data', () => {
    const editor = create([p('yellow', [mark()]), p('white', [mark('#fb923c'), ink('#ffffff')]),
      p('code', [mark(), { type: 'code' }]), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell', [mark(), ink('#ffffff')])] }] }] }]);
    const original = editor.getJSON(), marks = editor.view.dom.querySelectorAll<HTMLElement>('.nb-readable-ink');
    expect(marks).toHaveLength(4);
    for (const element of marks) expect(element.style.getPropertyValue('--nb-ink-dark')).toBeTruthy();
    expect(editor.view.dom.querySelector('code .nb-readable-ink')?.textContent).toBe('code');
    expect(editor.getJSON()).toEqual(original);
    expect(editor.getHTML()).not.toContain('nb-readable-ink');
    expect(editor.getHTML()).not.toContain('nb-screen-fill');
    expect(editor.commands.undo()).toBe(false);
  });
  it('keeps an uncolored highlight null when typed DOM is reparsed', () => {
    const editor = create([p('default highlight', [{type:'highlight'}]), p('legacy empty highlight', [{type:'highlight',attrs:{color:''}}])]);
    const dom = editor.view.dom.querySelector('mark')!;
    expect(dom.getAttribute('data-color')).toBeNull(); expect(dom.style.backgroundColor).toBe('');
    const parsed = DOMParser.fromSchema(editor.schema).parse(editor.view.dom);
    expect(parsed.firstChild!.firstChild!.marks.find(mark => mark.type.name === 'highlight')!.attrs.color).toBeNull();
    expect(parsed.lastChild!.firstChild!.marks.find(mark => mark.type.name === 'highlight')!.attrs.color).toBeNull();
    expect(editor.view.dom.querySelectorAll('.nb-readable-ink')).toHaveLength(2);
    for (const ink of editor.view.dom.querySelectorAll<HTMLElement>('.nb-readable-ink')) {
      expect(contrastRatio(ink.style.getPropertyValue('--nb-ink-dark'), darkBackground('#fef08a'))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('recomputes a changed block and preserves untouched blocks through typing and undo', () => {
    const editor = create([p('first', [mark()]), p('last', [mark('#fb923c')])]);
    const last = editor.view.dom.querySelectorAll('.nb-readable-ink')[1];
    editor.commands.insertContentAt(3, 'x');
    expect(editor.view.dom.querySelectorAll('.nb-readable-ink')[1]).toBe(last);
    editor.commands.undo();
    expect(editor.state.doc.firstChild!.textContent).toBe('first');
    expect(editor.view.dom.querySelectorAll('.nb-readable-ink')).toHaveLength(2);
    editor.view.dispatch(editor.state.tr.removeMark(1, 6, editor.schema.marks.highlight));
    expect(editor.view.dom.querySelectorAll('.nb-readable-ink')).toHaveLength(1);
    editor.view.dispatch(editor.state.tr.step(new NodeAttributesStep(0, { blockBackground: '#000000', blockTextColor: '#111111' })));
    const first = editor.view.dom.querySelector<HTMLElement>('.nb-readable-ink')!;
    expect(contrastRatio(first.style.getPropertyValue('--nb-ink-dark'), '#000000')).toBeGreaterThanOrEqual(4.5);
  });
  it('uses the same view-only correction for rich captions, regardless of mark order', () => {
    for (const marks of [[mark(), ink('#ffffff'), { type: 'code' }], [ink('#ffffff'), mark(), { type: 'code' }]]) {
      const root = document.createElement('div'), content = [text('caption', marks)];
      const before = JSON.stringify(content); renderFigureCaption(root, 'caption', content);
      const element = root.querySelector<HTMLElement>('.nb-readable-ink')!;
      expect(contrastRatio(element.style.getPropertyValue('--nb-ink-dark'), darkBackground('#fef08a'))).toBeGreaterThanOrEqual(4.5);
      expect(JSON.stringify(content)).toBe(before);
    }
  });
  it('keeps both image and table captions free of display compensation in schema HTML and clipboard', () => {
    const captionContent = [text('caption', [mark(), ink('#ffffff'), { type: 'code' }])];
    const editor = create([{ type: 'image', attrs: { src: 'local.png', caption: 'caption', captionContent } },
      { type: 'table', attrs: { caption: 'caption', captionContent }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell')] }] }] }]);
    const html = editor.getHTML(), clipboard = editor.view.serializeForClipboard(editor.state.doc.slice(0)).dom.innerHTML;
    for (const serialized of [html, clipboard]) {
      expect(serialized).not.toContain('nb-readable-ink'); expect(serialized).not.toContain('--nb-ink-'); expect(serialized).not.toContain('nb-screen-fill');
      const root = document.createElement('div'); root.innerHTML = serialized;
      for (const caption of root.querySelectorAll('caption,figcaption')) {
        expect(caption.querySelector<HTMLElement>('[data-text-color]')!.style.color).toBe('rgb(255, 255, 255)');
      }
      expect(root.querySelectorAll('caption,figcaption')).toHaveLength(2);
    }
  });
  it('recomputes inherited colors when a wrapper is added, removed or joined at a block boundary', () => {
    const editor = create([{ type: 'blockquote', attrs: { blockBackground: '#000000' }, content: [p('text', [ink('#111111')])] }, p('tail')]);
    editor.commands.setTextSelection(3);
    editor.commands.lift('blockquote');
    let visible = editor.view.dom.querySelector<HTMLElement>('.nb-readable-ink')!;
    expect(visible.style.getPropertyValue('--nb-ink-light')).toBe('#111111');
    editor.commands.wrapIn('blockquote', { blockBackground: '#000000' });
    visible = editor.view.dom.querySelector<HTMLElement>('.nb-readable-ink')!;
    expect(contrastRatio(visible.style.getPropertyValue('--nb-ink-light'), '#000000')).toBeGreaterThanOrEqual(4.5);
    editor.commands.setContent({ type: 'doc', content: [{ ...p('first'), attrs: { blockBackground: '#000000' } }, p('second')] });
    const boundary = editor.state.doc.firstChild!.nodeSize;
    editor.view.dispatch(editor.state.tr.join(boundary));
    visible = editor.view.dom.querySelector<HTMLElement>('.nb-readable-ink')!;
    expect(visible.textContent).toBe('firstsecond');
    expect(contrastRatio(visible.style.getPropertyValue('--nb-ink-light'), '#000000')).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps a 10,000 paragraph typing update confined to its changed paragraph', () => {
    const editor = create([]), schema = editor.schema, highlight = schema.marks.highlight.create({ color: '#fef08a' });
    const content = Array.from({ length: 10_000 }, () => schema.nodes.paragraph.create(null, schema.text('text', [highlight])));
    const plugin = createReadableInkPlugin();
    let state = EditorState.create({ doc: schema.nodes.doc.create(null, content), plugins: [plugin] });
    const original = Node.prototype.nodesBetween, visited: number[] = [];
    vi.spyOn(Node.prototype, 'nodesBetween').mockImplementation(function (this: Node, from, to, callback, start) {
      if (this.type.name === 'doc') visited.push(to - from);
      return original.call(this, from, to, callback, start);
    });
    for (let index = 0; index < 30; index++) state = state.apply(state.tr.insertText('x', 30_001));
    expect(visited).toHaveLength(30);
    expect(Math.max(...visited)).toBeLessThan(40);
    expect(plugin.getState(state)!.find()).toHaveLength(10_000);
    const previous = plugin.getState(state);
    state = state.apply(state.tr.setMeta('reading-position', true));
    expect(plugin.getState(state)).toBe(previous);
  });
  it('reuses 10,000-row table decorations for alignment, width, caption and their undo patches', () => {
    const editor = create([]), schema = editor.schema, highlight = schema.marks.highlight.create({ color: '#fef08a' });
    const row = schema.nodes.tableRow.create(null, schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, schema.text('cell', [highlight]))));
    const table = schema.nodes.table.create(null, Array.from({ length: 10_000 }, () => row));
    const plugin = createReadableInkPlugin();
    let state = EditorState.create({ doc: schema.nodes.doc.create(null, table), plugins: [plugin] });
    const scans = vi.spyOn(Node.prototype, 'nodesBetween');
    const previous = plugin.getState(state), step = new NodeAttributesStep(0, { tableAlign: 'right' }), undo = step.invert(state.doc);
    state = state.apply(state.tr.step(step)); state = state.apply(state.tr.step(undo));
    state = state.apply(state.tr.step(new NodeAttributesStep(0, { caption: 'Caption' })));
    state = state.apply(state.tr.step(new TableColumnWidthsStep(0, Array.from({ length: 10_000 }, () => [[120]]))));
    state = state.apply(state.tr.step(new TablePresentationStep(0, [{ pos: 1, textAlign: 'right' }])));
    expect(scans).not.toHaveBeenCalled(); expect(plugin.getState(state)).toBe(previous);
    state = state.apply(state.tr.step(new TablePresentationStep(0, [{ pos: 1, background: '#ffffff' }])));
    expect(scans).toHaveBeenCalled(); expect(plugin.getState(state)).not.toBe(previous);
  });
});
