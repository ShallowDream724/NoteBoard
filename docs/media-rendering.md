# Image rendering and interaction

The image document node owns the source path, accessible description (`alt`), title, width, alignment, and optional caption. The interactive editor, HTML export, and print export retain these attributes; adding or removing a caption must not change image placement.

## HTML and print

`ImageNode.renderHTML` always emits a `figure[data-nb-image]` containing one image and an optional `figcaption`. The figure owns width and alignment; the image fills that width once, with its aspect ratio preserved. Width accepts percentage, pixel, and legacy numeric pixel values. The original width and normalized alignment remain in `data-width` and `data-align` for HTML import. Existing bare `img` markup remains importable.

HTML and print use the same schema image serializer. Collection slots retain their own layout: a contained image figure fills the slot and has no independent margin. A slot paragraph caption and an image caption remain separate node data, and the editor suppresses duplicate visible captions. Nested image figures import as one image node per slot.

Portable Markdown keeps standard image syntax and caption text. Native width and alignment do not become proprietary Markdown syntax.

## Preview and drop feedback

One primary click on an image opens the shared preview in standalone, grid, and carousel contexts. Toolbar surfaces and controls, caption editing, resizing, pointer cancellation, and drag gestures do not trigger that shortcut. Pointer motion beyond six CSS pixels cancels the current click shortcut; the next pointer press starts a new gesture. The explicit preview toolbar button remains available.

Ordinary document drops show an insertion line at the whole block boundary, without a visible text label over the document. Collection drops instead show a bounded slot overlay and slot-specific hint. Drop feedback is transient and is removed or replaced when the target changes.

Regression coverage: `test/editor-md/imagePresentation.test.tsx`, `imageCaption.test.tsx`, and `imageDropRouting.test.ts`.
