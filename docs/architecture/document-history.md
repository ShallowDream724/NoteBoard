# Document history and presentation state

The document timeline owns undo/redo across visual and source editors. It stores
bounded checkpoints and reversible text patches; editor-local history supplies
group boundaries, not a second user-visible timeline.

`visualHistoryGrouping.ts` adds semantic boundaries at the shared visual capture
point. A structural creation, deletion, conversion or explicit discrete action
is isolated from both preceding and following typing, even when an insertion
entry point omits its discrete marker. Classification inspects each step's
mapped ranges and replaced slices, never enumerates the whole document, and
does not serialize the document on every key. Ordinary paragraph splits and
typing inside an existing textblock still use native timing/IME boundaries.
Replacing an existing atom's attribute-backed source remains an input gesture;
commands can explicitly mark a complete semantic operation as discrete.
Each editor owns its grouping state. Selection-only and view-only transactions
do not consume the boundary reserved for the next content edit.

For visual undo/redo, `documentReconciliation.ts` applies the differing slice of
the parsed target document. Native and Markdown codecs share this operation.
Unchanged ProseMirror nodes and mapped decorations survive, so undoing a deleted
formula or image does not clear unrelated code highlighting or rebuild all media.
The transaction remains excluded from local history and carries the existing
document-replacement origin for synchronization listeners. Selection restoration
scrolls once; focusing the editor must not schedule a second scroll.

A non-text node's attribute restoration uses `NodeAttributesStep`, with an empty
position map and the existing child-content identity. Text replacements always
use text steps, even though text nodes have equal empty child fragments. Caption metadata shares
the same attribute-update primitive. This avoids rebuilding table row caches,
code views or embedded controls merely to undo an attribute. A `data-editor-control`
host declares an owned input: history preserves its caret while it remains
connected, and returns to a legal document selection when its owner is removed.
Formula source and captions dispatch history shortcuts through the containing
editor, rather than maintaining another document timeline. Creating an empty
formula and entering/leaving its source explicitly close the input group.
Formula and diagram textareas share `useNativeSourceInput`: the browser owns IME
preedit, committed values enter the document once, and history maps the caret
through the changed source without replacing or refocusing the input.
Mermaid source writes each input to its node attribute, so source typing joins
the document timeline and Ctrl+Z can continue through diagram creation and
earlier content. A newly inserted default template opens its source through a
transient editor request; an existing diagram stays in preview until opened.
The source keeps its caret while the node survives an undo. Once its opening
value is restored, one more Ctrl+Z exits source mode; subsequent Ctrl+Z moves
through diagram creation and earlier document content. Code-block key events on
the React NodeView shell route undo and redo to that same document timeline.

Reading state is separate from content: heading folds and code-line folds live
in plugin state; whole-code wrapping/folding and disclosure expansion live in
their view state. These actions do not modify the document, add undo steps or
mark a clean tab as dirty. Editing a disclosure title or its body is a content
change. Carousel paging follows the same presentation-only boundary.

Regression coverage includes atom deletion/restoration next to highlighted code,
Markdown/native restoration, attributes/marks/nesting, and fold controls whose
transactions leave content unchanged.
Additional integration cases cover text → empty code/disclosure/table → inner
typing and the reverse redo sequence, formula source → empty formula → creation
→ preceding text, and caption undo without losing its focused editor. A long
code typing case verifies that classification does not enumerate document nodes.
Keyboard integration also covers code content, a newly inserted Mermaid
template, and editing an existing Mermaid diagram across earlier history.
