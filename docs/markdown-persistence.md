# Markdown persistence contracts

`buildDocumentExtensions()` owns the document grammar used by the editor, worker
conversion and export. UI extensions must extend these definitions instead of
introducing a separate Markdown representation.

- Mermaid, PlantUML (`plantuml`, `uml`, `puml`) and infographic (`infographic`,
  `info`) fences parse to their diagram nodes. Their serializers write a canonical
  language and choose a backtick fence longer than any run in the body. Diagram
  handlers precede the general code-block handler, which handles other languages.
- Colored highlights use a fixed `<mark data-color="…">…</mark>` representation.
  A dedicated tokenizer parses this form without a DOM. Only CSS color names,
  hexadecimal values and the supported numeric color functions are emitted;
  arbitrary HTML attributes, style declarations and URLs are not supported.
  Uncolored `==text==` syntax remains compatible with the upstream grammar.
- Table cell pipes receive GFM context escaping using the preceding backslash
  parity. Logical cell coordinates account for both colspan and rowspan. The
  shared `tableGrid.ts` helper returns one origin placement per actual cell and
  maintains occupied column intervals; it does not allocate covered grid slots.
- A `noteboard-table` comment preserves widths, heights, headers and merged-cell
  structure. New `grid: true` comments include each nontrivial row's logical
  cell coordinates; older packed-row comments remain readable. Comment JSON
  escapes angle brackets so cell content cannot terminate the comment.
- GFM cells cannot represent multiple paragraphs or block children, and its pipe
  unescaping can alter opaque code/math payloads. These cells additionally store
  their Markdown and emitted preview in `blocks` metadata. The block grammar is
  restored only while the visible GFM cell still matches that preview. Editing a
  preview externally therefore takes precedence over stale block metadata.
  Editors that discard comments retain the readable GFM preview, but lose these
  extended structures. Tables support at most 10000 logical columns; serialization
  rejects wider tables explicitly instead of emitting unreadable metadata.
- Redundant-escape cleanup collects ordered, non-overlapping source ranges, then
  assembles fragments once. Its existing single semantic parse still decides
  whether the complete cleanup can be accepted. It never repeatedly copies the
  whole document for individual candidates.

## CJK formatting boundaries

`markdownBoundary.ts` classifies Han, Hiragana, Katakana and Hangul letters as
word boundaries for paired formatting. `markdownLexer.ts` adapts the owning
Marked tokenizer's Unicode classes while retaining its delimiter-run algorithm,
nesting, escapes and Latin intraword-underscore rules. It never mutates global
Marked rules or adds whitespace/hidden characters to source. Equal-length,
temporary masks protect opaque code and math payloads; `==` and `++` use the
same opaque-region handling rather than a first-closing-pair regex.

`inlineFormatting.ts` reads tokens from the document manager's registered lexer,
including its extensions. Visual typing/paste removes only recognized delimiters
and applies marks in one transaction, preserving existing text and marks.
Typing does not run during IME preedit and explicitly caps matching at 4096
characters, even when Tiptap's node window returns a whole long text node.
Longer spans remain literal during typing and remain available to full parsing.
The UI adapter checks `supportsAutomaticMarks` before consuming input, so a
format requiring NB cannot swallow a closing keystroke in Markdown. Commands
and the final capability guard retain their existing conversion behavior.
The existing `++underline++` extension remains supported in Markdown; this
change does not redefine format capabilities or turn it into an NB-only mark.

CodeMirror keeps incremental block/code/link parsing. Its inline adapter uses
the same registered lexer and retains only numeric formatting ranges in a weak
cache for each live inline context. It creates no second editor/document model,
and there is no document-sized cache keyed by source strings.

Regression coverage: `markdownBoundaries.test.ts` checks parsing, source syntax,
typing, paste, real undo/redo transitions, nested opaque content and long input.
`scripts/check-cjk-formatting.mjs` runs full editor views in Chromium, including
IME composition, mode roundtrips, format restrictions and repeated 1000-paragraph
mode switches with GC/DOM measurements. Cross-editor Markdown rendering still
depends on the receiving application's grammar; exported HTML/PDF use NoteBoard's
parsed document.
