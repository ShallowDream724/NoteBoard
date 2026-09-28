import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { GitHubAlert } from '../../src/features/editor-md/alertExtension';
import { MathInline, MathBlock } from '../../src/features/editor-md/katexExtensions';
import { parseMarkdown, serializeMarkdown } from '../../src/features/editor-md/serialize';
import { buildDocumentExtensions, documentParser } from '../../src/features/editor-md/documentExtensions';
import { initializeEditorDocument, parseNativeNode, serializeNativeNode } from '../../src/features/editor-md/editorDocumentCodec';
import { canWrapBlockInCallout, completeAlert, insertCallout, updateCallout, wrapBlockInCallout } from '../../src/features/editor-md/alertCommands';
import { transactionAddedCapability } from '../../src/features/document-format/capabilityGuard';
import { portableMarkdown } from '../../src/features/export/portableMarkdown';
import { pandocSource } from '../../src/features/export/pandocDocument';
import { CALLOUT_DEFAULTS, CALLOUT_EXTRA_ICONS, calloutStyle, calloutTitle, isCalloutIcon } from '../../src/features/editor-md/calloutPresentation';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { acceptCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { sourceTypingAssist } from '../../src/features/editor-md/sourceTypingAssist';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CalloutMenu from '../../src/features/editor-md/CalloutMenu';
import { EmptyBlockInsertMenu } from '../../src/features/editor-md/EmptyBlockInsertMenu';

describe('提示块内容与保存', () => {
  for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    it(kind + ' 多段正文和公式可往返', () => {
      const editor = new Editor({ extensions: [StarterKit, GitHubAlert, MathInline, MathBlock, Markdown] });
      try {
        parseMarkdown(editor, '> [!' + kind + ']\n> **正文** $x^2$\n>\n> 第二段\n>\n> - 列表项\n\n后文');
        expect(editor.state.doc.firstChild?.type.name).toBe('githubAlert');
        expect(editor.state.doc.firstChild?.attrs.kind).toBe(kind.toLowerCase());
        expect(editor.state.doc.firstChild?.textContent).toContain('第二段');
        const saved = serializeMarkdown(editor);
        expect(saved).toContain('> [!' + kind + ']');
        expect(saved).toContain('**正文**');
        expect(saved).toContain('$x^2$');
        const before = editor.getJSON();
        parseMarkdown(editor, saved);
        expect(editor.getJSON()).toEqual(before);
      } finally { editor.destroy(); }
    });
  }
  it('空提示块也有明确的 Markdown 表示，不能在保存时消失', () => {
    const editor = new Editor({ extensions: [StarterKit, GitHubAlert, Markdown] });
    try {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'githubAlert', attrs: { kind: 'tip' }, content: [{ type: 'paragraph' }] }] });
      const saved = serializeMarkdown(editor);
      expect(saved).toContain('> [!TIP]');
      parseMarkdown(editor, saved);
      expect(editor.state.doc.firstChild?.type.name).toBe('githubAlert');
    } finally { editor.destroy(); }
  });
  for (const marker of ['[!]', '【！】', '【!tip]', '[！TIP】']) {
    it(`无引用前导也能补全 ${marker}`, () => {
      const editor = new Editor({ extensions: [StarterKit, GitHubAlert], content: `<p>${marker}</p><p>后文</p>` });
      try {
        editor.commands.setTextSelection(marker.length + 1);
        expect(completeAlert(editor, 'tip')).toBe(true);
        expect(editor.state.doc.firstChild?.attrs).toMatchObject({ kind: 'tip', title: null });
        expect(editor.state.doc.lastChild?.textContent).toBe('后文');
        expect(editor.state.selection.$from.node(-1).type.name).toBe('githubAlert');
        editor.commands.undo(); expect(editor.state.doc.firstChild?.textContent).toBe(marker);
      } finally { editor.destroy(); }
    });
  }
  it('完整中英文输入按 Enter 转为预设，普通正文不会被误转换', () => {
    const editor = new Editor({ extensions: [StarterKit, GitHubAlert], content: '<p>【！WARNING】</p>' });
    try {
      editor.commands.setTextSelection(12);
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(editor.state.doc.firstChild?.attrs.kind).toBe('warning');
      editor.commands.setContent('<p>普通正文</p>');
      expect(completeAlert(editor, 'note')).toBe(false);
    } finally { editor.destroy(); }
  });
  for (const marker of ['[!ti]', '【！ti】']) {
    it(`源码补全 ${marker} 生成标准GFM`, async () => {
      const view = new EditorView({ state: EditorState.create({ doc: marker, selection: { anchor: marker.length }, extensions: [sourceTypingAssist] }) });
      try {
        startCompletion(view);
        await vi.waitFor(() => expect(currentCompletions(view.state).map(item => item.label)).toEqual(['Tip']));
        expect(acceptCompletion(view)).toBe(true);
        expect(view.state.doc.toString()).toBe('> [!TIP]\n> ');
      } finally { view.destroy(); }
    });
  }
  it('显式背景自动选择对比文字，显式文字色始终优先', () => {
    expect(calloutStyle({ backgroundColor: '#f0fdf4' })).toMatchObject({ '--callout-text': '#18202b' });
    expect(calloutStyle({ backgroundColor: '#101010' })).toMatchObject({ '--callout-text': '#f8fafc' });
    expect(calloutStyle({ backgroundColor: '#101010', textColor: '#dc2626' })).toMatchObject({ '--callout-text': '#dc2626' });
  });
  it('原生插入默认显示标题，包裹保留原段落，属性更新单次撤销', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p><strong>原正文</strong></p>' });
    try {
      initializeEditorDocument(editor, '#!noteboard 1\n@block {"type":"paragraph"}\n', 'noteboard');
      expect(wrapBlockInCallout(editor, 0)).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.title).toBeNull();
      expect(calloutTitle(editor.state.doc.firstChild!.attrs)).toBe('Note');
      expect(editor.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold');
      expect(updateCallout(editor, 0, { title: '观察', icon: '🌱', textColor: '#15803d', borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' })).toBe(true);
      expect(editor.state.doc.firstChild?.attrs.icon).toBe('🌱');
      editor.commands.undo(); expect(editor.state.doc.firstChild?.attrs).toMatchObject({ title: null, icon: null, textColor: null });
      editor.commands.undo(); expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      editor.commands.setContent('<p></p>'); expect(insertCallout(editor)).toBe(true);
      expect(calloutTitle(editor.state.doc.firstChild!.attrs)).toBe('Note');
      expect(updateCallout(editor, 0, { title: '' })).toBe(true);
      const restored = parseNativeNode(serializeNativeNode(editor.state.doc), editor.schema);
      expect(calloutTitle(restored.firstChild!.attrs)).toBe('');
    } finally { editor.destroy(); }
  });
  it('加号菜单保持文字在首位及原提示块入口，并插入带标题的提示块', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p></p>', editorProps: { handleScrollToSelection: () => true } });
    const close = vi.fn();
    try {
      initializeEditorDocument(editor, '#!noteboard 1\n@block {"type":"paragraph"}\n', 'noteboard');
      await act(async () => root.render(<EmptyBlockInsertMenu editor={editor} pos={0} close={close}/>));
      const groups = Array.from(host.querySelectorAll('.nb-empty-block-menu > [role="group"]'));
      expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['文字与列表', '内容块', '图片', '公式与图表']);
      const callout = Array.from(groups[1].querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === '提示块')!;
      expect(callout.querySelector('.lucide-panel-top')).not.toBeNull();
      await act(async () => callout.click());
      expect(close).toHaveBeenCalledOnce();
      expect(editor.state.doc.firstChild?.type.name).toBe('githubAlert');
      expect(calloutTitle(editor.state.doc.firstChild!.attrs)).toBe('Note');
      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    } finally { await act(async () => root.unmount()); host.remove(); editor.destroy(); vi.unstubAllGlobals(); }
  });
  it('表格、分隔线和媒体不能转换为提示块，也不触发格式切换', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p>正文</p>' });
    try {
      const s = editor.schema.nodes;
      for (const block of [s.horizontalRule.create(), s.image.create({ src: 'image.png' }), s.codeBlock.create(),
        s.table.create(null, s.tableRow.create(null, s.tableCell.create(null, s.paragraph.create())))]) {
        editor.commands.setContent({ type: 'doc', content: [block.toJSON()] });
        const doc = editor.state.doc;
        expect(canWrapBlockInCallout(editor, 0)).toBe(false);
        expect(wrapBlockInCallout(editor, 0)).toBe(false);
        expect(editor.state.doc).toBe(doc);
      }
    } finally { editor.destroy(); }
  });
  it('GFM预设不触发能力门控，自定义属性有明确的提示块能力', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: '<p></p>' });
    try {
      const node = editor.schema.nodes.githubAlert;
      const body = editor.schema.nodes.paragraph.create();
      expect(transactionAddedCapability(editor.state.tr.replaceWith(0, 2, node.create({ kind: 'warning' }, body)))).toBeNull();
      expect(transactionAddedCapability(editor.state.tr.replaceWith(0, 2, node.create({ title: '' }, body)))).toBe('callout');
      expect(transactionAddedCapability(editor.state.tr.replaceWith(0, 2, node.create({ backgroundColor: '#f0fdf4' }, body)))).toBe('callout');
    } finally { editor.destroy(); }
  });
  it('原生/HTML保留属性；Markdown和Pandoc保留标题、emoji及全部正文', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [{ type: 'githubAlert', attrs: {
      kind: 'tip', title: '观察 *重点*', icon: '🌱', textColor: '#15803d', borderColor: '#bbf7d0', backgroundColor: '#f0fdf4',
    }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '首段', marks: [{ type: 'textColor', attrs: { color: '#dc2626' } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '第二段绝不作为标题' }] }] }] } });
    try {
      const doc = editor.state.doc, saved = serializeNativeNode(doc);
      expect(parseNativeNode(saved, documentParser().schema).toJSON()).toEqual(doc.toJSON());
      const html = editor.getHTML();
      expect(html).toMatch(/--callout-background:\s*#f0fdf4/);
      expect(html).toContain('data-callout-title="观察 *重点*"');
      expect(html).toContain('color: rgb(220, 38, 38)');
      const markdown = portableMarkdown(doc.toJSON());
      for (const text of ['[!TIP]', '🌱', '观察', '首段', '第二段绝不作为标题']) expect(markdown).toContain(text);
      expect(markdown).not.toMatch(/#f0fdf4|#15803d|data-callout/);
      const pandoc = pandocSource(doc);
      for (const text of ['🌱', '观察', '首段', '第二段绝不作为标题']) expect(pandoc).toContain(text);
      const roundtrip = new Editor({ extensions: buildDocumentExtensions(), content: html });
      try { expect(roundtrip.state.doc.firstChild?.attrs).toEqual(doc.firstChild?.attrs); } finally { roundtrip.destroy(); }
    } finally { editor.destroy(); }
  });
  it('完成图标只改图标，NB与HTML往返保留SVG，Markdown不泄漏图标标识', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const attrs = { ...CALLOUT_DEFAULTS, kind: 'tip' as const, title: '已核对', backgroundColor: '#f0fdf4' };
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [
      { type: 'githubAlert', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text: '保留正文' }] }] },
    ] } });
    try {
      initializeEditorDocument(editor, serializeNativeNode(editor.state.doc), 'noteboard');
      await act(async () => root.render(<CalloutMenu attrs={attrs} mode="icon" nativeVisible
        onChange={patch => { expect(patch).toEqual({ icon: 'success' }); expect(updateCallout(editor, 0, patch)).toBe(true); }}/>));
      expect(host.querySelectorAll('[aria-label="预设图标"] button')).toHaveLength(12);
      await act(async () => (host.querySelector('[aria-label="完成"]') as HTMLButtonElement).click());
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ ...attrs, icon: 'success' });
      const restored = parseNativeNode(serializeNativeNode(editor.state.doc), documentParser().schema);
      expect(restored.toJSON()).toEqual(editor.state.doc.toJSON());
      const html = editor.getHTML();
      expect(html).toContain('data-callout-icon="success"');
      expect(html).toContain(CALLOUT_EXTRA_ICONS.success.icon);
      const reopened = new Editor({ extensions: buildDocumentExtensions(), content: html });
      try { expect(reopened.state.doc.firstChild?.attrs).toEqual(restored.firstChild?.attrs); } finally { reopened.destroy(); }
      for (const exported of [portableMarkdown(restored.toJSON()), pandocSource(restored)]) {
        expect(exported).toContain('已核对'); expect(exported).toContain('保留正文'); expect(exported).not.toContain('success');
      }
      expect(portableMarkdown(restored.toJSON())).toContain('[!TIP]');
    } finally { await act(async () => root.unmount()); host.remove(); editor.destroy(); vi.unstubAllGlobals(); }
  });
  it('无效原生提示块属性局部恢复原文，emoji接受组合字形且拒绝文本', () => {
    for (const attrs of [{ kind: 'bad' }, { title: 42 }, { title: '跨\n行' }, { icon: '<img>' }, { textColor: 'red' }, { backgroundColor: 'url(a)' }]) {
      const source = '#!noteboard 1\n@block ' + JSON.stringify({ type: 'githubAlert', attrs, content: [{ type: 'paragraph' }] }) + '\n';
      const parsed = parseNativeNode(source, documentParser().schema);
      expect(parsed.firstChild?.type.name).toBe('nativeError');
      expect(serializeNativeNode(parsed)).toBe(source);
    }
    for (const emoji of ['👨‍👩‍👧‍👦', '🇨🇳', '👍🏽', '1️⃣']) expect(isCalloutIcon(emoji)).toBe(true);
    expect(isCalloutIcon('两个字')).toBe(false); expect(isCalloutIcon('💡💡')).toBe(false);
  });
  it('随机只改变背景；颜色重置不改变图标、标题和正文', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const patches: object[] = [];
    try {
      await act(async () => root.render(<CalloutMenu attrs={{ ...CALLOUT_DEFAULTS, title: '标题', icon: '💡' }} mode="appearance" nativeVisible onChange={patch => patches.push(patch)}/>));
      const buttons = () => Array.from(host.querySelectorAll('button'));
      await act(async () => buttons().find(button => button.textContent?.includes('随机背景'))!.click());
      expect(Object.keys(patches[0])).toEqual(['backgroundColor']);
      await act(async () => buttons().find(button => button.textContent?.includes('重置颜色'))!.click());
      expect(patches[1]).toEqual({ textColor: null, borderColor: null, backgroundColor: null });
    } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  });
});
