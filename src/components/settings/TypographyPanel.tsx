import { RotateCcw } from 'lucide-react';
import { getFileIcon } from '../FileIcon';
import { useId, useState } from 'react';
import { showToast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { contentWidthToPercent, CONTENT_WIDTH_PERCENT_MAP } from '../../core/theme/applyTheme';
import { FontSelect } from './FontSelect';
import { FontPackSettingsCard } from './FontPackSettingsCard';
import { SettingsPanelHeading, SettingsSection } from './SettingsControls';

function RangeField({ label, value, min, max, step = 1, unit = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  const id = useId();
  return <label className="nb-settings-field" htmlFor={id}><span className="nb-settings-field-label">{label}<output htmlFor={id}>{value}{unit}</output></span>
    <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/></label>;
}

function FontPair({ area, latin, chinese, mono = false, onLatinChange, onChineseChange }: {
  area: string; latin: string; chinese: string; mono?: boolean; onLatinChange: (font: string) => void; onChineseChange: (font: string) => void;
}) {
  return <div className="nb-settings-grid">
    <div className="nb-settings-field"><span className="nb-settings-label">西文字体{mono ? '（等宽）' : ''}</span>
      <FontSelect label={`${area}西文字体`} value={latin} filterType={mono ? 'mono' : 'en'} isMonospaceOnly={mono}
        placeholder="系统默认西文字体" onChange={onLatinChange}/></div>
    <div className="nb-settings-field"><span className="nb-settings-label">中文字体</span>
      <FontSelect label={`${area}中文字体`} value={chinese} filterType="zh" placeholder="系统默认中文字体" onChange={onChineseChange}/></div>
  </div>;
}

function WidthControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const presets = [{ key: 'narrow', label: '窄' }, { key: 'standard', label: '标准' }, { key: 'wide', label: '宽屏' }, { key: 'full', label: '全宽' }] as const;
  return <div className="nb-settings-field"><span className="nb-settings-label">{label}</span>
    <div className="nb-settings-presets" role="group" aria-label={label}>{presets.map(preset => <button key={preset.key} type="button"
      aria-pressed={contentWidthToPercent(value) === CONTENT_WIDTH_PERCENT_MAP[preset.key]} onClick={() => onChange(preset.key)}>
      {preset.label}<span>{CONTENT_WIDTH_PERCENT_MAP[preset.key]}%</span></button>)}</div>
    <RangeField label="自定义宽度" value={contentWidthToPercent(value)} min={40} max={100} unit="%" onChange={next => onChange(`${next}%`)}/>
  </div>;
}

export function TypographyPanel() {
  const { settings: { typography }, setTypography, resetTypography } = useSettingsStore();
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    try { await resetTypography(); showToast('排版与字体已恢复默认', 'success'); }
    catch (error) { showToast(`恢复失败：${String(error)}`, 'error'); }
    finally { setResetting(false); }
  };
  return <div className="nb-settings-panel">
    <SettingsPanelHeading title="排版与字体" description="分别调整界面、正文、代码和文件树，修改后即时预览。" actions={
      <button className="nb-btn-secondary nb-settings-reset-button" type="button" disabled={resetting} onClick={() => void reset()}><RotateCcw size={14}/>{resetting ? '正在恢复…' : '全部恢复默认'}</button>}/>
    <FontPackSettingsCard/>
    <SettingsSection title="软件界面" description="标题栏、标签页、菜单和弹窗。">
      <FontPair area="界面" latin={typography.uiFontFamily ?? ''} chinese={typography.uiFontFamilyZh ?? ''}
        onLatinChange={font => setTypography({ uiFontFamily: font })} onChineseChange={font => setTypography({ uiFontFamilyZh: font })}/>
      <RangeField label="界面字号" value={typography.uiFontSize ?? 13} min={12} max={18} unit="px" onChange={value => setTypography({ uiFontSize: value })}/>
      <div className="nb-settings-type-preview nb-settings-ui-preview" style={{ fontFamily: 'var(--ui-font-family)', fontSize: typography.uiFontSize ?? 13 }}>
        <strong>NoteBoard 界面</strong><span>文档已保存 · File saved</span></div>
    </SettingsSection>
    <SettingsSection title="Markdown 正文">
      <FontPair area="正文" latin={typography.contentFontFamily} chinese={typography.contentFontFamilyZh ?? ''}
        onLatinChange={font => setTypography({ contentFontFamily: font })} onChineseChange={font => setTypography({ contentFontFamilyZh: font })}/>
      <div className="nb-settings-grid">
        <RangeField label="正文字号" value={typography.contentFontSize} min={12} max={26} unit="px" onChange={value => setTypography({ contentFontSize: value })}/>
        <RangeField label="正文行高" value={typography.contentLineHeight} min={1.3} max={2.4} step={0.1} onChange={value => setTypography({ contentLineHeight: value })}/>
      </div>
      <WidthControl label="正文编辑区宽度" value={typography.contentWidth ?? 'wide'} onChange={value => setTypography({ contentWidth: value })}/>
      <div className="nb-settings-type-preview" style={{ fontFamily: 'var(--content-font-family)', fontSize: typography.contentFontSize, lineHeight: typography.contentLineHeight }}>
        记录想法，留住灵感。The quick brown fox 123.<br/><strong>加粗 Bold</strong> 与 <em>斜体 Italic</em>，让文字层次清晰。</div>
    </SettingsSection>
    <SettingsSection title="代码与纯文本" description="代码文件、纯文本和正文中的代码块。Ctrl + 滚轮也可调整代码字号。">
      <FontPair area="代码" latin={typography.monoFontFamily} chinese={typography.monoFontFamilyZh ?? ''} mono
        onLatinChange={font => setTypography({ monoFontFamily: font })} onChineseChange={font => setTypography({ monoFontFamilyZh: font })}/>
      <div className="nb-settings-grid">
        <RangeField label="代码字号" value={typography.monoFontSize ?? 14} min={10} max={24} unit="px" onChange={value => setTypography({ monoFontSize: value })}/>
        <RangeField label="代码行高" value={typography.monoLineHeight ?? 1.5} min={1.2} max={2.2} step={0.1} onChange={value => setTypography({ monoLineHeight: value })}/>
      </div>
      <WidthControl label="代码编辑区宽度" value={typography.monoContentWidth ?? 'full'} onChange={value => setTypography({ monoContentWidth: value })}/>
      <pre className="nb-settings-type-preview nb-typography-code-preview" style={{ fontFamily: 'var(--mono-font-family)', fontSize: typography.monoFontSize ?? 14, lineHeight: typography.monoLineHeight ?? 1.5 }}><code>{'// 记录今日灵感\nconst note = "Hello, NoteBoard";'}</code></pre>
    </SettingsSection>
    <SettingsSection title="文件树" description="左侧资源管理器中的文件与文件夹。">
      <FontPair area="文件树" latin={typography.explorerFontFamily ?? ''} chinese={typography.explorerFontFamilyZh ?? ''}
        onLatinChange={font => setTypography({ explorerFontFamily: font })} onChineseChange={font => setTypography({ explorerFontFamilyZh: font })}/>
      <div className="nb-settings-grid">
        <RangeField label="文件树字号" value={typography.explorerFontSize ?? 13} min={11} max={18} unit="px" onChange={value => setTypography({ explorerFontSize: value })}/>
        <RangeField label="条目行高" value={typography.explorerLineHeight ?? 24} min={20} max={36} unit="px" onChange={value => setTypography({ explorerLineHeight: value })}/>
      </div>
      <div className="nb-settings-type-preview nb-settings-explorer-preview" style={{ fontFamily: 'var(--explorer-font-family)', fontSize: typography.explorerFontSize ?? 13 }}>
        <div style={{ minHeight: typography.explorerLineHeight ?? 24 }}>{getFileIcon('Guide.md')}快速入门 Guide.md</div>
        <div style={{ minHeight: typography.explorerLineHeight ?? 24 }}>{getFileIcon('notes.json')}notes.json</div>
      </div>
    </SettingsSection>
  </div>;
}
