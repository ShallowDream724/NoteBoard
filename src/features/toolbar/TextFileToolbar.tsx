import { useState } from 'react';
import { Braces, CaseSensitive, Check, Minimize2, Search, WrapText } from 'lucide-react';
import { getEditorCapabilities } from '../../core/editor/editorRegistry';
import type { textToolbarKind } from '../../core/fileFormats';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDocumentStore } from '../../stores/documentStore';
import { openDocumentSearch } from '../search/openDocumentSearch';
import { ToolbarButton, ToolbarDropdown, ToolbarDropdownItem } from './ToolbarComponents';
import { ResponsiveToolbar } from './ResponsiveToolbar';

export function TextFileToolbar({ docKey, kind }: { docKey: string; kind: NonNullable<ReturnType<typeof textToolbarKind>> }) {
  const [caseMenu, setCaseMenu] = useState(false);
  const softWrap = useSettingsStore(state => state.settings.editor.softWrap);
  const readonly = useDocumentStore(state => state.getDocument(docKey)?.readonly);
  const ops = () => getEditorCapabilities(docKey)?.codeOps;
  if (kind === 'text') return <ResponsiveToolbar>
    <ToolbarButton icon={<Search size={15}/>} label="查找" title="查找文本" shortcut="Ctrl+F" onClick={() => openDocumentSearch('search')}/>
    <ToolbarButton icon={<WrapText size={15}/>} label="自动换行" title="自动换行" active={softWrap}
      onClick={() => void useSettingsStore.getState().setEditor({ softWrap: !softWrap })}/>
    <ToolbarDropdown isOpen={caseMenu} onOpenChange={setCaseMenu}
      trigger={<ToolbarButton icon={<CaseSensitive size={15}/>} label="大小写" title="转换英文字母大小写" hasDropdown/>}>
      {([['upper', '全部大写'], ['lower', '全部小写'], ['title', '词首大写']] as const).map(([mode, label]) =>
        <ToolbarDropdownItem key={mode} label={label} disabled={readonly} onClick={() => { setCaseMenu(false); ops()?.transformCase(mode); }}/>)}
    </ToolbarDropdown>
  </ResponsiveToolbar>;
  const json = kind === 'json';
  return <ResponsiveToolbar>
    <ToolbarButton icon={<Braces size={15}/>} label="格式化" title={json ? '格式化 JSON' : '格式化 XML'} disabled={readonly}
      onClick={() => json ? ops()?.expandJson({ scope: 'all', tabSize: useSettingsStore.getState().settings.editor.tabSize }) : ops()?.formatXml('all')}/>
    {json && <ToolbarButton icon={<Minimize2 size={15}/>} label="压缩" title="压缩 JSON" disabled={readonly} onClick={() => ops()?.minifyJson('all')}/>}
    <ToolbarButton icon={<Check size={15}/>} label="校验" title={json ? '校验 JSON' : '校验 XML'}
      onClick={() => json ? ops()?.validateJson('all') : ops()?.validateSyntax?.('all')}/>
  </ResponsiveToolbar>;
}
