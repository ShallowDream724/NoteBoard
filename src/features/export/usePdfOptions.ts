import { useRef, useState } from 'react';
import type { PdfPagePreferences } from '../../core/ipc/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { restorePdfOptions } from './pdfPreferences';
import type { ItemMode } from './model';

/** Snapshot on opening; remote defaults apply to the next session, not its current PDF. */
export function usePdfOptions(onSaveError: (error: unknown) => void) {
  const [options, setOptions] = useState(() => restorePdfOptions(useSettingsStore.getState().settings.export?.pdf));
  const current = useRef(options);
  const updatePage = <K extends keyof PdfPagePreferences>(key: K, value: PdfPagePreferences[K]) => {
    if (current.current[key] === value) return;
    current.current = { ...current.current, [key]: value };
    setOptions(current.current);
    // Only this committed field is intent. Sending the session snapshot would
    // erase newer defaults chosen in another window while this dialog was open.
    void useSettingsStore.getState().setExport({ pdf: { [key]: value } }).catch(onSaveError);
  };
  const updateItem = (id: string, mode: ItemMode) => {
    current.current = { ...current.current, items: { ...current.current.items, [id]: mode } };
    setOptions(current.current);
  };
  return { options, updatePage, updateItem };
}
