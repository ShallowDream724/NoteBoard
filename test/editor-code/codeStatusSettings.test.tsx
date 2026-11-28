import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodeStatusSettings } from '../../src/components/statusbar/CodeStatusSettings';
import { TEXT_LANGUAGE_CHOICES } from '../../src/core/textLanguageTools';
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
  await act(async () => press(trigger, 'Enter'));
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="语法高亮语言"]')!;
}

const press = (element: HTMLElement, key: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const languageRows = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));

it('shows the exact language menu rows and chooses a language by keyboard prefix', async () => {
  useDocumentStore.getState().upsertFromPayload({ key: docKey, displayName: 'source.py', dirPath: 'C:\\test', kind: 'code', language: 'python', content: 'print(1)', encoding: 'utf8', eol: 'lf', size: 8, mtime: 0, readonly: false });
  await act(async () => root.render(<StatusForOpenDocument />));

  const menu = await openLanguagePicker('Python');
  const auto = menu.querySelector<HTMLElement>('[role="menuitem"]')!;
  expect(auto.textContent).toBe('按文件名识别');
  expect(auto.querySelector('svg, [data-file-icon]')).toBeNull();
  expect(auto.nextElementSibling?.getAttribute('role')).toBe('separator');
  expect(menu.querySelector('input, small')).toBeNull();

  const rows = languageRows(menu);
  expect(rows.map(item => item.textContent)).toEqual([
    'Plain Text',
    ...TEXT_LANGUAGE_CHOICES.filter(choice => choice.value !== 'plaintext').map(choice => choice.label).sort((a, b) => a.localeCompare(b, 'en')),
  ]);
  const python = menu.querySelector('[aria-checked="true"]')!;
  expect(python.textContent).toBe('Python');
  expect(python.querySelector('[data-file-icon="lang-python"]')).toBeTruthy();
  expect(python.querySelector('.nb-status-menu-check svg')).toBeTruthy();

  await act(async () => {
    press(auto, 't');
    press(auto, 'y');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(document.activeElement?.textContent).toBe('TypeScript');
  await act(async () => press(document.activeElement as HTMLElement, 'Enter'));
  expect(useDocumentStore.getState().getDocument(docKey)).toMatchObject({ language: 'typescript', content: 'print(1)', isDirty: false });
  expect(document.body.contains(menu)).toBe(false);

  const typeScriptMenu = await openLanguagePicker('TypeScript');
  expect(languageRows(typeScriptMenu).slice(0, 2).map(item => item.textContent)).toEqual(['Plain Text', 'TypeScript']);
  expect(typeScriptMenu.querySelector('[role="group"] [role="separator"]')).toBeTruthy();
  expect(languageRows(typeScriptMenu).filter(item => item.textContent === 'TypeScript')).toHaveLength(1);
  await act(async () => {
    press(document.activeElement as HTMLElement, 'ArrowDown');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(document.activeElement?.textContent).toBe('Plain Text');
  await act(async () => press(document.activeElement as HTMLElement, 'Enter'));
  expect(useDocumentStore.getState().getDocument(docKey)?.language).toBe('plaintext');

  const plainTextMenu = await openLanguagePicker('纯文本');
  await act(async () => plainTextMenu.querySelector<HTMLElement>('[role="menuitem"]')!.click());
  expect(useDocumentStore.getState().getDocument(docKey)?.language).toBe('python');
});

it('starts with Plain Text when there is no filename to detect', async () => {
  await act(async () => root.render(<CodeStatusSettings docKey="untitled:test" language="plaintext" />));
  const menu = await openLanguagePicker('纯文本');
  expect(menu.querySelector('[role="menuitem"]')).toBeNull();
  expect(languageRows(menu)[0].textContent).toBe('Plain Text');
});

it('uses a keyboard-accessible indentation menu and changes only the open file settings', async () => {
  const key = 'test.html';
  const content = '  <p>HTML</p>';
  useDocumentStore.getState().upsertFromPayload({ key, displayName: key, dirPath: '', kind: 'code',
    language: 'html', content, encoding: 'utf8', eol: 'lf', size: content.length, mtime: 0, readonly: false });
  const startingSettings = useSettingsStore.getState().settings.editor;
  await act(async () => root.render(<CodeStatusSettings docKey={key} language="html" />));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="缩进：空格 2"]')!;
  const item = (role: string, label: string) => Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`))
    .find(element => element.textContent === label)!;
  expect(host.querySelector('button[aria-label="语法高亮语言：HTML"]')).toBeTruthy();
  await act(async () => press(trigger, 'Enter'));
  expect(item('menuitemradio', '使用空格缩进').getAttribute('aria-checked')).toBe('true');
  const indent = document.querySelector('[role="menu"][aria-label="缩进设置"]')!;
  expect([...indent.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="separator"]')].map(element => (
    element.getAttribute('role') === 'separator' ? 'separator' : element.textContent
  ))).toEqual([
    '使用空格缩进', '使用制表符缩进', 'separator', '缩进大小', 'separator',
    '将缩进转换为空格', '将缩进转换为制表符', 'separator', '从内容中检测缩进方式',
  ]);
  await act(async () => item('menuitemradio', '使用制表符缩进').click());
  expect(trigger.textContent).toBe('Tab 2');

  await act(async () => press(trigger, 'Enter'));
  expect(item('menuitemradio', '使用制表符缩进').getAttribute('aria-checked')).toBe('true');
  await act(async () => press(item('menuitem', '缩进大小'), 'ArrowRight'));
  expect(item('menuitemradio', '2').getAttribute('aria-checked')).toBe('true');
  await act(async () => item('menuitemradio', '4').click());
  expect(trigger.textContent).toBe('Tab 4');
  expect(useDocumentStore.getState().getDocument(key)).toMatchObject({ indentation: { insertSpaces: false, tabSize: 4 }, content, isDirty: false });
  expect(useSettingsStore.getState().settings.editor).toBe(startingSettings);
  expect(patchSettings).not.toHaveBeenCalled();
});
