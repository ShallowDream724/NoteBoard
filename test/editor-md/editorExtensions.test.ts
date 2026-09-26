import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, expect, it, vi } from 'vitest';
import { buildExtensions } from '../../src/features/editor-md/extensions';

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  vi.unstubAllGlobals();
});

it.each(['empty', 'native', 'markdown'] as const)('opens and remounts the complete %s editor extension assembly', format => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const code = 'def greet(name):\n    return name';
  const document: JSONContent = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '示例' }] },
    { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: code }] },
  ] };
  for (let mount = 0; mount < 2; mount++) {
    const editor = new Editor({ extensions: buildExtensions(`startup-${format}-${mount}`),
      ...(format === 'markdown' ? { content: `## 示例\n\n\`\`\`python\n${code}\n\`\`\``, contentType: 'markdown' } :
        { content: format === 'empty' ? { type: 'doc', content: [{ type: 'paragraph' }] } : document }),
    });
    editors.push(editor);
    expect(editor.isDestroyed).toBe(false);
    if (format !== 'empty') expect(editor.state.doc.textContent).toContain(code);
    expect(editor.commands.insertContent('可编辑')).toBe(true);
    expect(editor.state.doc.textContent).toContain('可编辑');
  }
});
