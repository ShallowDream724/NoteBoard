import { type AnyExtension, type Extensions, type JSONContent, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Code } from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Blockquote from '@tiptap/extension-blockquote';
import { TaskItem } from '@tiptap/extension-list';
import { TableCell, TableHeader } from '@tiptap/extension-table';
import { MarkdownTable, SizedTableRow } from './markdownTable';
import { MarkdownHighlight } from './markdownHighlight';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { DocumentPresentation } from './documentPresentation';
import { MathInlineNode, MathBlockNode, AlertNode, ImageNode, MermaidNode, PlantUmlNode, InfographicNode } from './documentNodes';
import { serializeMarkdownFromDoc, type MarkdownManagerLike } from './serialize';
import { createMarkdownLexer } from './markdownLexer';
import { MarkdownOrderedList, MarkdownTaskList } from './markdownLists';

// Markdown permits marks around inline code. Application layout owns Ctrl+Shift+B.
const MarkdownCode = Code.extend({ excludes: '', addKeyboardShortcuts() { return {}; } });
const MarkdownBlockquote = Blockquote.extend({ addKeyboardShortcuts() { return {}; } });

/** One document grammar for editing, worker conversion and external formats. */
export function buildDocumentExtensions(views: Record<string, AnyExtension> = {}): Extensions {
  return [
    StarterKit.configure({
      code: false, codeBlock: false, blockquote: false, orderedList: false,
      undoRedo: { depth: 200, newGroupDelay: 300 },
      link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: null, title: 'Ctrl + 单击以访问链接' } },
      dropcursor: { width: 2, color: 'var(--editor-accent)', class: 'nb-dropcursor' },
    }),
    // Highlight must wrap inline code; serializing its markup inside backticks
    // would turn the mark into literal code and discard the highlight on reload.
    MarkdownHighlight.configure({ multicolor: true }), MarkdownCode, MarkdownBlockquote, ImageNode,
    MarkdownOrderedList, MarkdownTaskList, TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    MarkdownTable.configure({ resizable: true, cellMinWidth: 40, HTMLAttributes: { class: 'nb-table' } }), SizedTableRow, TableCell, TableHeader,
    MathInlineNode, MathBlockNode, MermaidNode, PlantUmlNode, InfographicNode, CodeBlock, AlertNode, DocumentPresentation,
    Markdown.configure({ marked: createMarkdownLexer() }),
  ].map(extension => views[extension.name] ?? extension);
}

let parser: { manager: MarkdownManager; schema: ReturnType<typeof getSchema> } | undefined;
function documentParser() {
  if (!parser) {
    const extensions = buildDocumentExtensions();
    parser = { manager: new MarkdownManager({ extensions, marked: createMarkdownLexer() }), schema: getSchema(extensions) };
  }
  return parser;
}
export function parseMarkdownDocument(markdown: string) {
  const { schema, manager } = documentParser();
  return schema.nodeFromJSON(manager.parse(markdown));
}
export function materializeDocument(json: JSONContent) {
  const { schema, manager } = documentParser();
  const doc = schema.nodeFromJSON(json);
  return { doc, markdown: serializeMarkdownFromDoc(manager as unknown as MarkdownManagerLike, schema, doc) };
}
