import type { Text } from '@codemirror/state';
import type { DocumentHistorySelection, RecordDocumentChangeOptions } from '../history/documentHistory';

interface CodeSnapshotInput {
  text: Text;
  revision: number;
  startsNewGroup: boolean;
  beforeSelection?: DocumentHistorySelection;
  selection?: DocumentHistorySelection;
}

interface CodeSnapshotOptions {
  /** The owner must still hold both the document session and editor registration. */
  isCurrent: () => boolean;
  commit: (content: string, revision: number, options: RecordDocumentChangeOptions) => void;
  pendingChanged: () => void;
}

/** Instance-local snapshots keep one immutable Text per unfinished history group.
 * Serialization and history diffing happen only at a group or read boundary. */
export function createCodeSnapshot(options: CodeSnapshotOptions) {
  let pending: CodeSnapshotInput | null = null;
  let materialized: { text: Text; content: string } | null = null;

  const discard = () => {
    const hadPending = pending !== null;
    pending = null;
    materialized = null;
    if (hadPending) options.pendingChanged();
  };

  const flushPending = (): string | null => {
    if (!options.isCurrent()) {
      discard();
      return null;
    }
    if (!pending) return null;
    const snapshot = pending;
    const content = snapshot.text.toString();
    // Keep the snapshot until serialization and commit both succeed, so a failed
    // read cannot silently skip this group on the next undo/save attempt.
    options.commit(content, snapshot.revision, {
      mode: 'code',
      startsNewGroup: snapshot.startsNewGroup,
      beforeSelection: snapshot.beforeSelection,
      selection: snapshot.selection,
    });
    pending = null;
    materialized = { text: snapshot.text, content };
    options.pendingChanged();
    return content;
  };

  return {
    stage(snapshot: CodeSnapshotInput): void {
      if (!options.isCurrent()) return;
      if (pending && snapshot.startsNewGroup) flushPending();
      const previous = pending;
      pending = {
        ...snapshot,
        // Later transactions in this group must not erase its start boundary.
        startsNewGroup: previous?.startsNewGroup ?? snapshot.startsNewGroup,
        beforeSelection: previous?.beforeSelection ?? snapshot.beforeSelection,
      };
      materialized = null;
      if (!previous) options.pendingChanged();
    },
    flushPending,
    read(text: Text): string | null {
      if (!options.isCurrent()) {
        discard();
        return null;
      }
      const content = flushPending();
      if (content !== null && materialized?.text === text) return content;
      if (materialized?.text === text) return materialized.content;
      const current = text.toString();
      materialized = { text, content: current };
      return current;
    },
    /** History navigation already has the exact string; cache it without flattening Text. */
    accept(text: Text, content: string): void {
      pending = null;
      materialized = { text, content };
      options.pendingChanged();
    },
    hasPending: () => pending !== null && options.isCurrent(),
    discard,
  };
}
