import { expect, it } from 'vitest';
import { SettingsReplica, useSettingsStore } from '../../src/stores/settingsStore';
import type { Settings } from '../../src/core/ipc/types';

const base = (): Settings => structuredClone(useSettingsStore.getState().settings);

it('an earlier acknowledgement preserves later local intent and unrelated remote fields', () => {
  const initial = base(), replica = new SettingsReplica(initial);
  const first = replica.enqueue({ editor: { softWrap: false } });
  const second = replica.enqueue({ editor: { showWhitespace: true } });
  const acknowledged = { ...initial, revision: 1, editor: { ...initial.editor, softWrap: false } };
  replica.settle(first, acknowledged);
  expect(replica.view().editor).toMatchObject({ softWrap: false, showWhitespace: true });
  const remote = { ...acknowledged, revision: 3, file: { ...initial.file, showHiddenFiles: true }, editor: { ...acknowledged.editor, showWhitespace: true } };
  replica.receive(remote);
  replica.settle(second, { ...acknowledged, revision: 2, editor: { ...acknowledged.editor, showWhitespace: true } });
  expect(replica.view().revision).toBe(3);
  expect(replica.view().file.showHiddenFiles).toBe(true);
  expect(replica.view().editor.showWhitespace).toBe(true);
});

it('a failed write removes only its own optimistic patch', () => {
  const initial = base(), replica = new SettingsReplica(initial);
  const failed = replica.enqueue({ editor: { softWrap: false } });
  replica.enqueue({ editor: { showWhitespace: true } });
  replica.receive({ ...initial, revision: 1, file: { ...initial.file, showHiddenFiles: true } });
  replica.settle(failed);
  expect(replica.view().editor.softWrap).toBe(initial.editor.softWrap);
  expect(replica.view().editor.showWhitespace).toBe(true);
  expect(replica.view().file.showHiddenFiles).toBe(true);
});

it('a broadcast arriving during initialization wins over the stale load and reordered broadcasts', () => {
  const initial = base(), replica = new SettingsReplica(initial);
  const newer = { ...initial, revision: 8, editor: { ...initial.editor, tabSize: 8 } };
  replica.receive(newer);
  replica.receive({ ...initial, revision: 7 });
  replica.receive(initial);
  expect(replica.view()).toBe(newer);
});

it('a later remote change to the same field wins after the local write is acknowledged', () => {
  const initial = base(), replica = new SettingsReplica(initial);
  const id = replica.enqueue({ editor: { tabSize: 4 } });
  replica.receive({ ...initial, revision: 2, editor: { ...initial.editor, tabSize: 8 } });
  expect(replica.view().editor.tabSize).toBe(4);
  replica.settle(id, { ...initial, revision: 1, editor: { ...initial.editor, tabSize: 4 } });
  expect(replica.view().editor.tabSize).toBe(8);
});
