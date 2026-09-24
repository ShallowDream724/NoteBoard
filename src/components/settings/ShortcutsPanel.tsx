import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, Plus, X, Search } from 'lucide-react';
import { SHORTCUTS, type ShortcutDefinition, type ShortcutContext } from '../../core/shortcutCatalog';
import { commandBindings, normalizeShortcut, shortcutFromEvent, shortcutValidation, shortcutConflicts, resolveShortcut } from '../../core/shortcutBindings';
import { useShortcutBindings } from '../../core/useShortcutBindings';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkShortcutSystem, useShortcutDiagnosticsStore } from '../../stores/shortcutDiagnosticsStore';
import { showToast } from '../../stores/toastStore';
import './shortcutsPanel.css';

const scopes: Record<string, string> = { app: '全局', markdown: 'Markdown 正文', source: 'Markdown 源码', code: '代码与纯文本', explorer: '资源管理器', diagram: '图表源码', mindmap: '思维导图', search: '查找与替换' };
const EMPTY_OVERRIDES: Record<string, string[] | null> = {};
function ShortcutEditor({ command, onClose }: { command: ShortcutDefinition; onClose: () => void }) {
  const [draft, setDraft] = useState([...commandBindings(command.id)]), [recording, setRecording] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    const values = draft.filter(value => value.trim()).map(value => normalizeShortcut(value) ?? value);
    for (const value of values) {
      const invalid = shortcutValidation(value), conflicts = shortcutConflicts(command.id, value);
      if (invalid || conflicts.length) { setError(invalid ?? `与“${conflicts.map(item => item.label).join('、')}”冲突`); return; }
    }
    setBusy(true); setError(null); setRecording(null);
    try {
      const system = await checkShortcutSystem(values), occupied = system.filter(item => item.status === 'occupied');
      if (occupied.length) { setError(`已被系统或其他程序占用：${occupied.map(item => item.binding).join('、')}。请选择其他组合。`); return; }
      await useSettingsStore.getState().setShortcuts({ [command.id]: [...new Set(values)] });
      await useShortcutDiagnosticsStore.getState().refresh();
      if (system.some(item => item.status === 'unknown')) showToast('快捷键已保存，系统占用检测不可用。可在下方测试是否收到按键。', 'info');
      onClose();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  };
  return <div className="nb-shortcut-editor" role="group" aria-label={`修改${command.label}`}>
    {draft.map((value, index) => <div className="nb-shortcut-draft" key={index}>
      <input aria-label={`组合键 ${index + 1}`} value={value} placeholder="例如 Ctrl+Alt+1" disabled={busy}
        onChange={event => { setDraft(values => values.map((old, i) => i === index ? event.target.value : old)); setError(null); }}
        onKeyDown={event => {
          if (recording !== index) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Escape') { setRecording(null); return; }
          const key = shortcutFromEvent(event.nativeEvent);
          if (key) { setDraft(values => values.map((old, i) => i === index ? key : old)); setRecording(null); setError(null); }
        }}/>
      <button type="button" className="nb-btn-secondary" disabled={busy} aria-label={`录入组合键 ${index + 1}`}
        onClick={event => { setRecording(index); (event.currentTarget.previousElementSibling as HTMLInputElement).focus(); }}><Keyboard size={15}/>{recording === index ? '请按键…' : '录入'}</button>
      <button type="button" className="nb-shortcut-icon" disabled={busy} aria-label={`移除组合键 ${index + 1}`} onClick={() => { setDraft(values => values.filter((_, i) => i !== index)); setRecording(null); }}><X size={15}/></button>
    </div>)}
    <p>录入无响应时，可直接输入组合键。留空将停用该命令的快捷键。</p>
    {error && <div role="alert" className="nb-shortcut-error">{error}</div>}
    <div className="nb-shortcut-edit-actions">
      {draft.length < 4 && <button type="button" className="nb-btn-secondary" disabled={busy} onClick={() => setDraft(values => [...values, ''])}><Plus size={14}/>添加组合</button>}
      <span/>
      <button type="button" className="nb-btn-secondary" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="nb-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? '检查并保存…' : '保存'}</button>
    </div>
  </div>;
}

export function ShortcutsPanel() {
  const revision = useShortcutBindings();
  const { results, checking, error, refresh } = useShortcutDiagnosticsStore();
  const [query, setQuery] = useState(''), [editing, setEditing] = useState<string | null>(null), [received, setReceived] = useState('');
  const overrides = useSettingsStore(state => state.settings.shortcuts?.overrides ?? EMPTY_OVERRIDES);
  useEffect(() => { void refresh(); }, [revision, refresh]);
  const reset = async (id?: string) => {
    try { await useSettingsStore.getState().setShortcuts(id ? { [id]: null } : Object.fromEntries(Object.keys(overrides).map(key => [key, null]))); setEditing(null); }
    catch (failure) { showToast(String(failure), 'error'); }
  };
  const visible = SHORTCUTS.filter(command => `${command.label} ${commandBindings(command.id).join(' ')} ${command.group}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="nb-shortcuts-panel">
    <div className="nb-shortcuts-heading"><div><h3>快捷键</h3><p>按功能修改，同一命令的多个组合均可调整。</p></div>
      <button type="button" className="nb-btn-secondary" onClick={() => void reset()}><RotateCcw size={14}/>全部恢复默认</button></div>
    <div className="nb-shortcuts-search"><Search size={16}/><input aria-label="搜索快捷键" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索功能或组合键"/></div>
    <div className="nb-shortcut-diagnostics"><p>系统检测只检查当前已注册的占用。其他程序之后可能注册快捷键；输入法或键盘钩子也可能拦截按键。“未发现占用”不等于已验证可用。</p>
      <button type="button" className="nb-btn-secondary" disabled={checking} onClick={() => void refresh()}>{checking ? '正在检测…' : '重新检测系统占用'}</button>{error && <p role="status">系统检测不可用：{error}</p>}</div>
    {[...new Set(visible.map(command => command.group))].map(group => <section key={group} className="nb-shortcut-group"><h4>{group}</h4>
      {visible.filter(command => command.group === group).map(command => {
        const bindings = commandBindings(command.id), occupied = bindings.filter(key => results[key]?.status === 'occupied');
        return <div className="nb-shortcut-item" key={command.id}><div className="nb-shortcut-row">
          <div><strong>{command.label}</strong><small>{command.contexts.map(context => scopes[context]).join(' · ')}</small></div>
          <button type="button" className="nb-shortcut-binding" aria-label={`修改${command.label}`} onClick={() => setEditing(editing === command.id ? null : command.id)}>
            {bindings.length ? bindings.map(key => <kbd key={key}>{key.replaceAll('+', ' + ')}</kbd>) : <span>未设置</span>}</button>
          <button type="button" className="nb-shortcut-icon" aria-label={`恢复${command.label}默认快捷键`} disabled={!overrides[command.id]} onClick={() => void reset(command.id)}><RotateCcw size={14}/></button>
        </div>{occupied.length > 0 && <p className="nb-shortcut-error">系统占用：{occupied.join('、')}</p>}
          {editing === command.id && <ShortcutEditor command={command} onClose={() => setEditing(null)}/>}</div>;
      })}</section>)}
    {!visible.length && <p>没有匹配的快捷键。</p>}
    <section className="nb-shortcut-group"><h4>按键测试</h4><p>点击下面的区域后按组合键，仅显示 NoteBoard 是否收到按键，不执行文档操作。</p>
      <button type="button" className="nb-shortcut-test" onKeyDown={event => {
        if (event.key === 'Tab' || event.key === 'Escape') return;
        event.preventDefault(); event.stopPropagation(); const key = shortcutFromEvent(event.nativeEvent);
        if (key) setReceived(`已收到 ${key}：${resolveShortcut(event.nativeEvent, 'app')?.label ?? ['markdown','source','code','explorer','diagram'].map(context => resolveShortcut(event.nativeEvent, context as ShortcutContext)?.label).find(Boolean) ?? '未绑定命令'}`);
      }}>点击这里开始测试</button><p role="status">{received || '尚未收到组合键'}</p>
    </section>
    <section className="nb-shortcut-group"><h4>输入与导航约定</h4><p>方向键移动、Tab 焦点导航、Enter 确认、Esc 关闭和系统复制／粘贴遵循控件惯例。Markdown 的 /、&gt; [!、··· 后回车属于输入语法；Ctrl + 滚轮用于代码字号缩放。</p></section>
  </div>;
}
