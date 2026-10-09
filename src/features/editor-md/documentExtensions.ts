import { type AnyExtension, type Extensions, type JSONContent, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Code } from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Blockquote from '@tiptap/extension-blockquote';
import { TaskItem } from '@tiptap/extension-list';
import { PresentedTableCell, PresentedTableHeader } from './tableCellPresentation';
import { MarkdownTable, SizedTableRow } from './markdownTable';
import { MarkdownHighlight } from './markdownHighlight';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { DocumentPresentation } from './documentPresentation';
import { MathInlineNode, MathBlockNode, AlertNode, ImageNode, MermaidNode, PlantUmlNode, InfographicNode } from './documentNodes';
import { serializeMarkdownFromDoc, type MarkdownManagerLike } from './serialize';
import { createMarkdownLexer } from './markdownLexer';
import { MarkdownOrderedList, MarkdownTaskList } from './markdownLists';
import { TextColor, BlockPresentation } from '../document-style/documentStyleSchema';
import { installPresentationCodec } from '../document-style/presentationMetadata';
import { richContentGrammar } from './rich-content/schema';
import { annotationSchemaExtensions } from './annotations/schema';
import { NativeError } from './nativeError';
import { BlockAppearance } from '../document-style/blockAppearanceSchema';
import { inlineCodeComposition, inlineCodeInputRule, mapInlineCodeComposition } from './inlineCodeInput';
import { Plugin } from '@tiptap/pm/state';
import { InlineFormattingInput, withoutFormattingRules } from './inlineFormattingInput';
import { pairedFormattingTokenizer } from './inlineFormattingMask';
import { ScopedListCommands } from './scopedListCommands';
import { ParagraphCommands } from './paragraphCommands';

const ConsistentStarterKit = StarterKit.extend({
  addExtensions() { return (this.parent?.() ?? []).map(extension => withoutFormattingRules(extension.name === 'underline'
    ? extension.extend({ markdownTokenizer: pairedFormattingTokenizer('underline', '++') }) : extension)); },
});

// Markdown permits marks around inline code. Application layout owns Ctrl+Shift+B.
const MarkdownCode = Code.extend({
  excludes: '',
  addKeyboardShortcuts() { return {}; },
  addInputRules() { return [inlineCodeInputRule(this.editor, this.type)]; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      state: { init: () => null, apply(tr) { mapInlineCodeComposition(editor, tr); return null; } },
      props: { handleDOMEvents: inlineCodeComposition(editor) },
    })];
  },
});
const MarkdownBlockquote = Blockquote.extend({ addKeyboardShortcuts() { return {}; } });
const PresentedMarkdown = Markdown.extend({ onBeforeCreate(event) {
  const content = this.editor.options.content, contentType = this.editor.options.contentType;
  this.parent?.(event);
  installPresentationCodec(this.storage.manager, this.editor.schema);
  if (contentType === 'markdown' && typeof content === 'string') this.editor.options.content = this.storage.manager.parse(content);
} });

/** One document grammar for editing, worker conversion and external formats. */
export function buildDocumentExtensions(views: Record<string, AnyExtension> = {}): Extensions {
  return [
    ConsistentStarterKit.configure({
      code: false, codeBlock: false, blockquote: false, orderedList: false,
      undoRedo: { depth: 200, newGroupDelay: 300 },
      link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: null, title: 'Ctrl + 单击以访问链接' } },
      dropcursor: { width: 2, color: 'var(--editor-accent)', class: 'nb-dropcursor' },
    }),
    // Highlight must wrap inline code; serializing its markup inside backticks
    // would turn the mark into literal code and discard the highlight on reload.
    withoutFormattingRules(MarkdownHighlight.configure({ multicolor: true })), InlineFormattingInput, TextColor, BlockPresentation, BlockAppearance, MarkdownCode, MarkdownBlockquote, ImageNode,
    MarkdownOrderedList, MarkdownTaskList, TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }), ScopedListCommands, ParagraphCommands,
    MarkdownTable.configure({ resizable: true, cellMinWidth: 40, HTMLAttributes: { class: 'nb-table' } }), SizedTableRow, PresentedTableCell, PresentedTableHeader,
    MathInlineNode, MathBlockNode, MermaidNode, PlantUmlNode, InfographicNode, CodeBlock, AlertNode, DocumentPresentation, NativeError, ...richContentGrammar, ...annotationSchemaExtensions,
    PresentedMarkdown.configure({ marked: createMarkdownLexer() }),
  ].map(extension => views[extension.name] ?? extension);
}

let parser: { manager: MarkdownManager; schema: ReturnType<typeof getSchema> } | undefined;
export function documentParser() {
  if (!parser) {
    const extensions = buildDocumentExtensions();
    parser = { manager: new MarkdownManager({ extensions, marked: createMarkdownLexer() }), schema: getSchema(extensions) };
    installPresentationCodec(parser.manager, parser.schema);
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
