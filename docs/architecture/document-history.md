# Document history and presentation state

The document timeline owns undo/redo across visual and source editors. It stores
bounded checkpoints and reversible text patches; editor-local history supplies
group boundaries, not a second user-visible timeline.

For visual undo/redo, `documentReconciliation.ts` applies the differing slice of
the parsed target document. Native and Markdown codecs share this operation.
Unchanged ProseMirror nodes and mapped decorations survive, so undoing a deleted
formula or image does not clear unrelated code highlighting or rebuild all media.
The transaction remains excluded from local history and carries the existing
document-replacement origin for synchronization listeners. Selection restoration
scrolls once; focusing the editor must not schedule a second scroll.

Reading state is separate from content: heading folds and code-line folds live
in plugin state; whole-code wrapping/folding and disclosure expansion live in
their view state. These actions do not modify the document, add undo steps or
mark a clean tab as dirty. Editing a disclosure title or its body is a content
change. Carousel paging follows the same presentation-only boundary.

Regression coverage includes atom deletion/restoration next to highlighted code,
Markdown/native restoration, attributes/marks/nesting, and fold controls whose
transactions leave content unchanged.
