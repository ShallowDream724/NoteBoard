import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { DOMParser } from '@tiptap/pm/model';
import { buildDocumentExtensions } from '../../src/features/editor-md/documentExtensions';
import { encodeNativeDocument, decodeNativeDocument } from '../../src/core/nativeDocument';

describe('authored transparent colors', () => {
  it('survives schema validation, native persistence, HTML import and theme projections without changing stored values', () => {
    const editor = new Editor({ extensions: buildDocumentExtensions(), content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockBackground: '#abcdef80' }, content: [{ type: 'text', text: 'body', marks: [{ type: 'textColor', attrs: { color: '#12345680' } }] }] },
      { type: 'githubAlert', attrs: { textColor: '#ffffff40', borderColor: '#12345680', backgroundColor: '#abcdef40' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alert' }] }] },
    ] }, editorProps: { handleScrollToSelection: () => true } });
    try {
      editor.state.doc.check();
      const original = editor.getJSON(), native = encodeNativeDocument(original);
      expect(decodeNativeDocument(native)).toEqual(original);
      const root = document.createElement('div'); root.innerHTML = editor.getHTML();
      const imported = DOMParser.fromSchema(editor.schema).parse(root);
      expect(imported.firstChild?.attrs.blockBackground).toBe('#abcdef80');
      expect(imported.firstChild?.firstChild?.marks.find(mark => mark.type.name === 'textColor')?.attrs.color).toBe('#12345680');
      expect(imported.lastChild?.attrs).toMatchObject({ textColor: '#ffffff40', borderColor: '#12345680', backgroundColor: '#abcdef40' });
      expect(editor.view.dom.querySelector('.nb-screen-fill')?.getAttribute('style')).toContain('--nb-fill-dark:');
      for (const theme of ['chen-guang', 'hu-po', 'mo-ye']) { editor.view.dom.dataset.theme = theme; expect(editor.getJSON()).toEqual(original); }
    } finally { editor.destroy(); }
  });
});
