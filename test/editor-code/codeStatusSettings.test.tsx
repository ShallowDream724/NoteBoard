import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodeStatusSettings } from '../../src/components/statusbar/CodeStatusSettings';
import { patchSettings } from '../../src/core/ipc/commands';
import { useDocumentStore } from '../../src/stores/documentStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

vi.mock('../../src/core/ipc/commands', () => ({ patchSettings: vi.fn() }));

const docKey = 'C:\\test\\source.py';
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useDocumentStore.getState().clear();
  vi.unstubAllGlobals();
});

function StatusForOpenDocument() {
  const language = useDocumentStore(state => state.documents.get(docKey)?.language);
  return language && <CodeStatusSettings docKey={docKey} language={language} />;
}

async function openLanguagePicker(language: string) {
  const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="语法高亮语言：${language}"]`)!;
  await act(async () => trigger.click());
  return document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}

it('chooses syntax by extension with the keyboard and restores filename detection', async () => {
  useDocumentStore.getState().upsertFromPayload({ key: docKey, displayName: 'source.py', dirPath: 'C:\\test', kind: 'code', language: 'python', content: 'print(1)', encoding: 'utf8', eol: 'lf', size: 8, mtime: 0, readonly: false });
  await act(async () => root.render(<StatusForOpenDocument />));

  const search = await openLanguagePicker('Python');
  expect(document.activeElement).toBe(search);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '.tsx');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelector('[role="listbox"]')?.textContent).toMatch(/^TypeScript/);
  await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(useDocumentStore.getState().getDocument(docKey)).toMatchObject({ language: 'typescript', content: 'print(1)', isDirty: false });
  expect(document.querySelector('input[role="combobox"]')).toBeNull();

  await openLanguagePicker('TypeScript');
  const plainText = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.startsWith('纯文本'))!;
  await act(async () => plainText.click());
  expect(useDocumentStore.getState().getDocument(docKey)?.language).toBe('plaintext');

  await openLanguagePicker('纯文本');
  await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click());
  expect(useDocumentStore.getState().getDocument(docKey)?.language).toBe('python');
});

it('persists indentation from the HTML-source status without exposing a language override', async () => {
  const startingSettings = useSettingsStore.getState().settings;
  vi.mocked(patchSettings).mockImplementation(async () => ({ ...useSettingsStore.getState().settings, revision: useSettingsStore.getState().settings.revision + 1 }));
  try {
    await act(async () => root.render(<CodeStatusSettings docKey="test.html" language="html" showLanguage={false} />));
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(trigger.textContent).toBe('空格 2');
    await act(async () => trigger.click());

    const [method, width] = document.querySelectorAll<HTMLSelectElement>('[aria-label="缩进设置"] select');
    await act(async () => { method.value = 'tabs'; method.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { width.value = '4'; width.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(patchSettings).toHaveBeenCalledWith({ editor: { insertSpaces: false } });
    expect(patchSettings).toHaveBeenCalledWith({ editor: { tabSize: 4 } });
    expect(trigger.textContent).toBe('Tab 4');
  } finally {
    await act(async () => useSettingsStore.getState()._applyRemoteUpdate({ ...startingSettings, revision: useSettingsStore.getState().settings.revision + 1 }));
  }
});
