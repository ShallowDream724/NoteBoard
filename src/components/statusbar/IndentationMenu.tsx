import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { getEditorCapabilities, subscribeEditorCapabilities } from '../../core/editor/editorRegistry';
import { resolveIndentation } from '../../core/editor/indentationSettings';
import { useDocumentStore } from '../../stores/documentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { showToast } from '../../stores/toastStore';

const widths = [1, 2, 3, 4, 5, 6, 7, 8];

function Checkmark() {
  return <span className="nb-status-menu-check" aria-hidden="true">
    <Menu.ItemIndicator><Check size={14} /></Menu.ItemIndicator>
  </span>;
}

export function IndentationMenu({ docKey }: { docKey: string }) {
  const settings = useSettingsStore(state => state.settings.editor);
  const indentation = useDocumentStore(state => state.documents.get(docKey)?.indentation);
  const readonly = useDocumentStore(state => state.documents.get(docKey)?.readonly);
  const ops = useSyncExternalStore(
    useCallback(listener => subscribeEditorCapabilities(key => { if (key === docKey) listener(); }), [docKey]),
    useCallback(() => getEditorCapabilities(docKey)?.codeOps?.indentation, [docKey]),
  );
  const [working, setWorking] = useState(false);
  const focusEditorOnClose = useRef(false);
  const { insertSpaces, tabSize: width } = resolveIndentation(settings, indentation);
  const label = `${insertSpaces ? '空格' : 'Tab'} ${width}`;

  const isCurrent = () => getEditorCapabilities(docKey)?.codeOps?.indentation === ops;

  async function convert(toSpaces: boolean) {
    if (!ops || working || readonly) return;
    focusEditorOnClose.current = true;
    setWorking(true);
    try {
      const result = await ops.convert(toSpaces);
      if (!isCurrent() || result === 'unavailable') return;
      if (result === 'changed' || result === 'unchanged') {
        const documents = useDocumentStore.getState();
        if (documents.getDocument(docKey)?.indentation === indentation) documents.setIndentation(docKey, { insertSpaces: toSpaces });
      }
      if (result === 'unchanged') showToast('当前文件没有需要转换的缩进');
      if (result === 'syntax-unavailable') showToast('无法完整识别文件语法，缩进转换未执行', 'warning');
    } catch {
      if (isCurrent()) showToast('缩进转换失败', 'error');
    } finally {
      setWorking(false);
    }
  }

  async function detect() {
    if (!ops || working) return;
    setWorking(true);
    try {
      const result = await ops.detect();
      if (!isCurrent() || result === 'unavailable') return;
      if (result === 'syntax-unavailable' || !result) {
        showToast('未检测到明确的缩进格式');
        return;
      }
      const documents = useDocumentStore.getState();
      if (documents.getDocument(docKey)?.indentation === indentation) documents.setIndentation(docKey, result);
    } catch {
      if (isCurrent()) showToast('缩进检测失败', 'error');
    } finally {
      setWorking(false);
    }
  }

  const selectIndentation = (value: 'spaces' | 'tabs') =>
    useDocumentStore.getState().setIndentation(docKey, { insertSpaces: value === 'spaces' });

  return <Menu.Root modal={false}>
    <Menu.Trigger type="button" className="nb-code-status-trigger" aria-label={`缩进：${label}`} title="更改缩进设置">
      <span>{label}</span>
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content className="nb-status-menu" side="top" align="end" sideOffset={5} collisionPadding={8}
        data-shortcuts-suspended aria-label="缩进设置" onCloseAutoFocus={event => {
          if (!focusEditorOnClose.current) return;
          focusEditorOnClose.current = false;
          const editor = getEditorCapabilities(docKey);
          if (!editor) return;
          event.preventDefault();
          editor.focus();
        }}>
        <Menu.RadioGroup value={insertSpaces ? 'spaces' : 'tabs'} onValueChange={value => selectIndentation(value === 'tabs' ? 'tabs' : 'spaces')}>
          <Menu.RadioItem className="nb-status-menu-item" value="spaces"><Checkmark /><span>使用空格缩进</span></Menu.RadioItem>
          <Menu.RadioItem className="nb-status-menu-item" value="tabs"><Checkmark /><span>使用制表符缩进</span></Menu.RadioItem>
        </Menu.RadioGroup>
        <Menu.Separator className="nb-status-menu-separator" />
        <Menu.Sub>
          <Menu.SubTrigger className="nb-status-menu-item">
            <span>缩进大小</span>
            <ChevronRight className="nb-status-menu-arrow" size={14} aria-hidden="true" />
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent className="nb-status-menu nb-status-menu-narrow" sideOffset={4} collisionPadding={8}
              data-shortcuts-suspended aria-label="缩进大小">
              <Menu.RadioGroup value={String(width)} onValueChange={value => useDocumentStore.getState().setIndentation(docKey, { tabSize: Number(value) })}>
                {widths.map(size => <Menu.RadioItem key={size} className="nb-status-menu-item" value={String(size)}>
                  <Checkmark /><span>{size}</span>
                </Menu.RadioItem>)}
              </Menu.RadioGroup>
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
        <Menu.Separator className="nb-status-menu-separator" />
        <Menu.Item className="nb-status-menu-item" disabled={!ops || working || readonly} onSelect={() => void convert(true)}>将缩进转换为空格</Menu.Item>
        <Menu.Item className="nb-status-menu-item" disabled={!ops || working || readonly} onSelect={() => void convert(false)}>将缩进转换为制表符</Menu.Item>
        <Menu.Separator className="nb-status-menu-separator" />
        <Menu.Item className="nb-status-menu-item" disabled={!ops || working} onSelect={() => void detect()}>从内容中检测缩进方式</Menu.Item>
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
