# Open document identity changes

Explorer rename and Save As share `session/documentIdentity.ts`. A path change
must preserve editor authority, unsaved work and the file-level history; moving
only a store mirror is insufficient because Markdown input can remain in its
   pending snapshot for 500 ms.

1. Claim the existing transfer protection and blur the focused editor, allowing
   IME composition to finish. Protected identities cannot close, accept new
   saves or enter another migration. Window close and native reconciliation wait
   until this protection is released.
2. Flush the editor authority and materialize Markdown pending snapshots while
   the original session generation is valid. Cancel pending image recycling and
   restore this session's previously recycled managed images before their native
   paths change. These files remain available for undo in the migrated history,
   including images not referenced by the current revision. Drain its document write queue and
   the staging queue. This flush does **not** save unsaved text to the document.
3. Rename through `rename_path(label, from, to, expectedKeys)`. Under the native
   registry lock, verify that every registered source document belongs to the
   caller and is included in its captured set. Reject other-window ownership,
   an uncaptured concurrent open, a live prepare reservation or transfer, and
   destination conflicts. One filesystem rename and the native registry identity
   changes commit together; failures preserve the original registrations.
4. After the last awaited operation, synchronously materialize any remaining
   pending input **before** advancing the generation. Move history, revisions,
   synchronization progress, baseline, staging references and compatible view
   state. Then publish the new document and tab keys. The old editor is replaced
   by a new host, whose kind and language follow the new extension.

Directory renames use this same transaction for each open descendant, with
normalized, case-insensitive path matching and segment boundaries. A failed final
pending serialization rolls the native rename back before publishing local keys.
Native rename does not copy or rewrite document bodies. It uses one filesystem
rename while retaining the registry lock, so no competing registration can enter
between the filesystem and ownership commits. The frontend destination collision
check builds a normalized path set once, taking O(D × L) time and space for D
open paths of average length L; it does not rescan every source for every target.
This bound covers collision detection, not the subsequent per-document migration.
Repeated extension changes, including extensionless → Markdown → DOC/DOCX →
Markdown, reclassify both document and tab without converting their file contents.

Save As retains its existing target registration and explicit body write. The
same identity barriers capture edits made while writing or releasing the original
registration. Its original generation remains valid through that final await;
the new baseline is the text actually written, and later input stays dirty.
Staging cleanup acts on the migrated key with proof of the saved content.

Focused checks cover pending input during drain and native rename, preserved
history/revision/staging, dirty rename without a body write, failed rename,
normalized directory descendants, extension changes, native conflict rejection,
and Save As input/history arriving during ownership release.
