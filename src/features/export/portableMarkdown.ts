import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { DOMSerializer } from '@tiptap/pm/model';
import { buildDocumentExtensions, documentParser } from '../editor-md/documentExtensions';
import { MarkdownTable } from '../editor-md/markdownTable';
import { createMarkdownLexer } from '../editor-md/markdownLexer';
import { projectRichContent } from './richProjection';

/** Presentation is discarded from a copy, never from the authoritative tree.
 * Code, formulas, links and embedded diagram source remain content. */
export function withoutPresentation(node: JSONContent): JSONContent {
  const { attrs, marks, content, ...rest } = node;
  const cleanAttrs = attrs && Object.fromEntries(Object.entries(attrs)
    .filter(([key]) => !['textColor', 'background', 'textAlign', 'verticalAlign', 'indent', 'height', 'colwidth', 'width', 'align'].includes(key)));
  return {
    ...rest,
    ...(cleanAttrs && Object.keys(cleanAttrs).length ? { attrs: cleanAttrs } : {}),
    ...(marks ? { marks: marks.filter(mark => mark.type !== 'highlight' && mark.type !== 'textColor') } : {}),
    ...(content ? { content: content.filter(child => child.type !== 'documentPresentation').map(withoutPresentation) } : {}),
  };
}

const PortableTable = MarkdownTable.extend({
  renderMarkdown(node, helpers, context) {
    const complex = node.content?.some(row => row.content?.some(cell => cell.content?.length !== 1 || cell.content[0]?.type !== 'paragraph'));
    if (!complex) {
      // Strip only our own generated table preamble, not user-authored comments
      // in code/text. Merged slots are empty; each origin's content occurs once.
      return MarkdownTable.config.renderMarkdown!(node, helpers, context).replace(/^\n<!-- noteboard-table [^\n]* -->\n/, '\n');
    }
    // GFM cannot hold lists or fenced blocks inside a cell. Standard HTML keeps
    // that content intact without a private recovery comment.
    const { schema } = documentParser();
    const serializer = DOMSerializer.fromSchema(schema);
    const nodes = { ...serializer.nodes,
      mathInline: (value: import('@tiptap/pm/model').Node) => ['span', '$' + (value.attrs.latex ?? value.attrs.source ?? '') + '$'] as const,
      mathBlock: (value: import('@tiptap/pm/model').Node) => ['pre', '$$\n' + (value.attrs.latex ?? value.attrs.source ?? '') + '\n$$'] as const,
      mermaidBlock: (value: import('@tiptap/pm/model').Node) => ['pre', ['code', value.attrs.code]] as const,
      plantumlBlock: (value: import('@tiptap/pm/model').Node) => ['pre', ['code', value.attrs.code]] as const,
      infographicBlock: (value: import('@tiptap/pm/model').Node) => ['pre', ['code', value.attrs.code]] as const,
    };
    const host = document.createElement('div');
    host.appendChild(new DOMSerializer(nodes, serializer.marks).serializeNode(schema.nodeFromJSON(node)));
    for (const element of host.querySelectorAll('*')) for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'style' || attribute.name === 'class' || attribute.name.startsWith('data-')) element.removeAttribute(attribute.name);
    }
    return '\n' + host.innerHTML + '\n';
  },
});
let manager: MarkdownManager | undefined;
export function portableMarkdown(document: JSONContent): string {
  manager ??= new MarkdownManager({ extensions: buildDocumentExtensions({ table: PortableTable }), marked: createMarkdownLexer() });
  return manager.serialize(withoutPresentation(projectRichContent(document, 'portable').document));
}
