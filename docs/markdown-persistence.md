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
