import { useEffect, useRef, useState } from 'react';
import { Keyboard, RotateCcw, Plus, Search, Check, X } from 'lucide-react';
import { SHORTCUTS, type ShortcutDefinition, type ShortcutContext } from '../../core/shortcutCatalog';
import { commandBindings, normalizeShortcut, shortcutFromEvent, shortcutValidation, shortcutConflicts, resolveShortcut } from '../../core/shortcutBindings';
import { useShortcutBindings } from '../../core/useShortcutBindings';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkShortcutSystem, useShortcutDiagnosticsStore } from '../../stores/shortcutDiagnosticsStore';
import { showToast } from '../../stores/toastStore';
import './shortcutsPanel.css';

const scopes: Record<ShortcutContext, string> = { app: '全局', markdown: 'Markdown 正文', source: 'Markdown 源码', code: '代码与纯文本', explorer: '资源管理器', diagram: '图表源码', mindmap: '思维导图', search: '查找与替换' };
const EMPTY_OVERRIDES: Record<string, string[] | null> = {};
type Feedback = { kind: 'error' | 'success' | 'pending'; text: string } | null;

function bindingError(command: ShortcutDefinition, value: string, index: number) {
  const invalid = shortcutValidation(value);
  if (invalid) return invalid;
  if (commandBindings(command.id).some((binding, position) => position !== index && binding === normalizeShortcut(value))) return '这个命令已使用该组合键';
  const conflicts = shortcutConflicts(command.id, value);
  return conflicts.length ? `与“${conflicts.map(item => item.label).join('、')}”冲突，请换一个组合键` : null;
}

/** A binding is the recording target; no draft form or separate save step on the common path. */
function ShortcutRow({ command, active, onActivate, onFinish, customized, occupied }: {
  command: ShortcutDefinition; active: boolean; onActivate: () => void; onFinish: () => void; customized: boolean; occupied: string[];
}) {
  const bindings = commandBindings(command.id);
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(0);
  const row = useRef<HTMLDivElement>(null);
  const recorder = useRef<HTMLButtonElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) { operation.current++; setBusy(false); setManual(false); setFeedback(previous => previous?.kind === 'pending' ? null : previous); }
  }, [active]);
  useEffect(() => () => { operation.current++; }, []);
  useEffect(() => { if (manual) input.current?.focus(); }, [manual]);

  const begin = (position: number, target: HTMLButtonElement) => {
    operation.current++; setIndex(position); setManual(false); setDraft(''); setFeedback(null); setBusy(false);
    recorder.current = target; onActivate(); target.focus();
  };
  const cancel = () => {
    operation.current++; setBusy(false); setFeedback(null); onFinish(); recorder.current?.focus();
  };
  const persist = async (values: string[] | null, message: string, candidate?: string) => {
    const current = ++operation.current, previous = [...commandBindings(command.id)];
    setBusy(true); setFeedback({ kind: 'pending', text: candidate ? '正在检查组合键…' : '正在保存…' });
    try {
      let unknown = false;
      if (candidate) {
        const result = await checkShortcutSystem([candidate]);
        if (current !== operation.current) return;
        if (result.some(item => item.status === 'occupied')) {
          setFeedback({ kind: 'error', text: `${candidate} 已被系统或其他程序占用，请换一个组合键` }); return;
        }
        unknown = result.some(item => item.status === 'unknown');
        // A different window may have changed this command while the native probe was running.
        if (JSON.stringify(previous) !== JSON.stringify(commandBindings(command.id))) {
          setFeedback({ kind: 'error', text: '快捷键已在其他窗口更新，请重新选择组合键' }); onFinish(); return;
        }
        const invalid = bindingError(command, candidate, index);
        if (invalid) { setFeedback({ kind: 'error', text: invalid }); return; }
      }
      setFeedback({ kind: 'pending', text: '正在保存…' });
      await useSettingsStore.getState().setShortcuts({ [command.id]: values });
      if (current !== operation.current) return;
      setFeedback({ kind: 'success', text: `${message}${unknown ? ' · 系统检测不可用，可在上方测试按键' : ''}` });
      onFinish();
      row.current?.querySelector<HTMLButtonElement>('.nb-shortcut-binding')?.focus();
    } catch (failure) {
      if (current === operation.current) setFeedback({ kind: 'error', text: `未保存：${String(failure)}` });
    } finally { if (current === operation.current) setBusy(false); }
  };
  const record = (value: string) => {
    const invalid = bindingError(command, value, index);
    if (invalid) { setFeedback({ kind: 'error', text: invalid }); return; }
    const normalized = normalizeShortcut(value)!;
    if (bindings[index] === normalized) { setFeedback({ kind: 'success', text: '已是当前快捷键' }); onFinish(); return; }
    const values = [...bindings]; values[index] = normalized;
    void persist(values, '已保存', normalized);
  };
  const capture = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!active) return;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === 'Tab' && plain) { cancel(); return; }
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    if (event.key === 'Escape' && plain) { cancel(); return; }
    if (event.repeat || event.nativeEvent.isComposing || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    const value = shortcutFromEvent(event.nativeEvent);
    if (value) record(value);
    else setFeedback({ kind: 'error', text: '无法识别这个按键，请使用 Ctrl、Alt 组合或功能键' });
  };
  const renderBinding = (binding: string | undefined, position: number) => <button key={position} type="button"
    className="nb-shortcut-binding" data-shortcut-recording={active && index === position && !manual ? '' : undefined}
    aria-label={position === 0 ? `修改${command.label}` : `修改${command.label}的组合键 ${position + 1}`}
    aria-describedby={active ? `shortcut-feedback-${command.id}` : undefined}
    aria-busy={busy || undefined} onClick={event => { if (!busy) begin(position, event.currentTarget); }} onKeyDown={capture}>
    {active && index === position ? <><Keyboard size={14}/><span>{busy ? '正在检查…' : '请按组合键…'}</span></>
      : binding ? <kbd>{binding.replaceAll('+', ' + ')}</kbd> : <span>设置快捷键</span>}
  </button>;
  return <div ref={row} className="nb-shortcut-item" data-editing={active || undefined}>
    <div className="nb-shortcut-row">
      <div className="nb-shortcut-command"><strong>{command.label}</strong><small>{command.contexts.map(context => scopes[context]).join(' · ')}</small></div>
      <div className="nb-shortcut-bindings">
        {(bindings.length ? bindings : [undefined]).map(renderBinding)}
        {bindings.length > 0 && bindings.length < 4 && <button type="button" className="nb-shortcut-icon" aria-label={`为${command.label}添加组合键`} title="添加组合键" aria-busy={busy || undefined}
          data-shortcut-recording={active && index === bindings.length && !manual ? '' : undefined}
          onClick={event => { if (!busy) begin(bindings.length, event.currentTarget); }} onKeyDown={capture}><Plus size={14}/></button>}
      </div>
      <button type="button" className="nb-shortcut-icon" aria-label={`恢复${command.label}默认快捷键`} title="恢复默认" disabled={!customized || busy}
        onClick={() => void persist(null, '已恢复默认')}><RotateCcw size={14}/></button>
    </div>
    {active && <div className="nb-shortcut-recording-tools">
      {manual ? <input ref={input} data-shortcut-recording aria-label={`手动输入${command.label}组合键`} value={draft} placeholder="例如 Ctrl+Alt+1" readOnly={busy}
        onChange={event => { setDraft(event.target.value); const error = event.target.value ? bindingError(command, event.target.value, index) : null; setFeedback(error ? { kind: 'error', text: error } : null); }}
        onKeyDown={event => { event.stopPropagation(); if (busy) { if (event.key !== 'Tab') event.preventDefault(); return; } if (event.key === 'Escape') { event.preventDefault(); cancel(); } else if (event.key === 'Enter') { event.preventDefault(); record(draft); } }}/>
        : <span>{busy ? '正在处理组合键，请稍候' : `${index >= bindings.length ? '按下新的组合键即可添加' : '按下新的组合键即可替换'} · Esc 取消`}</span>}
      {manual && <span>Enter 确认</span>}
      {!manual && <button type="button" className="nb-shortcut-text-button" disabled={busy} onClick={() => { setManual(true); setDraft(''); }}>手动输入</button>}
      {index < bindings.length && <button type="button" className="nb-shortcut-text-button" disabled={busy} onClick={() => void persist(bindings.filter((_, position) => position !== index), '已移除组合键')}>移除</button>}
      <button type="button" className="nb-shortcut-icon" disabled={busy} aria-label={`取消修改${command.label}`} onClick={cancel}><X size={14}/></button>
    </div>}
    <div id={`shortcut-feedback-${command.id}`} className="nb-shortcut-feedback" aria-live="polite">
      {feedback && <p className={`nb-shortcut-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.kind === 'success' && <Check size={13}/>} {feedback.text}</p>}
      {!feedback && occupied.length > 0 && <p className="nb-shortcut-error">系统占用：{occupied.join('、')}</p>}
    </div>
  </div>;
}

export function ShortcutsPanel() {
  const revision = useShortcutBindings();
  const { results, checking, error, refresh } = useShortcutDiagnosticsStore();
  const [query, setQuery] = useState(''), [editing, setEditing] = useState<string | null>(null), [received, setReceived] = useState('');
  const [testing, setTesting] = useState(false), [resetting, setResetting] = useState(false);
  const overrides = useSettingsStore(state => state.settings.shortcuts?.overrides ?? EMPTY_OVERRIDES);
  useEffect(() => { void refresh(); }, [revision, refresh]);
  const reset = async () => {
    setEditing(null); setResetting(true);
    try { await useSettingsStore.getState().setShortcuts(Object.fromEntries(Object.keys(overrides).map(key => [key, null]))); }
    catch (failure) { showToast(String(failure), 'error'); }
    finally { setResetting(false); }
  };
  const visible = SHORTCUTS.filter(command => `${command.label} ${commandBindings(command.id).join(' ')} ${command.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="nb-shortcuts-panel">
    <header className="nb-settings-panel-heading nb-shortcuts-heading"><div><h3>快捷键</h3><p>点击组合键后直接按键修改，通过检查后自动保存。</p></div>
      <button type="button" className="nb-btn-secondary" disabled={resetting || !Object.keys(overrides).length} onClick={() => void reset()}><RotateCcw size={14}/>{resetting ? '正在恢复…' : '全部恢复默认'}</button></header>
    <section className="nb-shortcut-test-section" aria-label="按键测试">
      <div><h4><Keyboard size={16}/>按键测试</h4><p>确认 NoteBoard 能否收到组合键，不执行文档操作。</p></div>
      <button type="button" className="nb-shortcut-test" aria-label="按键测试" onFocus={() => { setEditing(null); setTesting(true); }} onBlur={() => setTesting(false)} onKeyDown={event => {
        if (event.key === 'Tab' || event.key === 'Escape') return;
        event.preventDefault(); event.stopPropagation(); const key = shortcutFromEvent(event.nativeEvent);
        if (key) setReceived(`已收到 ${key} · ${resolveShortcut(event.nativeEvent, 'app')?.label ?? (Object.keys(scopes) as ShortcutContext[]).map(context => resolveShortcut(event.nativeEvent, context)?.label).find(Boolean) ?? '未绑定命令'}`);
      }}>{testing ? '请按组合键…' : '点击测试组合键'}</button>
      <p role="status" className="nb-shortcut-test-result">{received || '等待测试'}</p>
    </section>
    <div className="nb-shortcuts-toolbar"><div className="nb-shortcuts-search"><Search size={16}/><input aria-label="搜索快捷键" value={query} onFocus={() => setEditing(null)} onChange={event => setQuery(event.target.value)} placeholder="搜索功能或组合键"/></div>
      <details className="nb-shortcut-diagnostics"><summary>系统占用检测</summary><div><p>检查当前系统注册的占用；按键是否被拦截，可通过上方测试确认。</p>
        <button type="button" className="nb-btn-secondary" disabled={checking} onClick={() => void refresh()}>{checking ? '正在检测…' : '重新检测'}</button>{error && <p role="status">系统检测不可用：{error}</p>}</div></details></div>
    {[...new Set(visible.map(command => command.group))].map(group => <section key={group} className="nb-shortcut-group"><h4>{group}</h4>
      {visible.filter(command => command.group === group).map(command => <ShortcutRow key={command.id} command={command}
        active={editing === command.id} onActivate={() => setEditing(command.id)} onFinish={() => setEditing(current => current === command.id ? null : current)}
        customized={Object.hasOwn(overrides, command.id)} occupied={commandBindings(command.id).filter(key => results[key]?.status === 'occupied')}/>)}</section>)}
    {!visible.length && <p className="nb-shortcut-empty">没有匹配的快捷键。</p>}
    <details className="nb-shortcut-conventions"><summary>输入与导航约定</summary><p>方向键移动、Tab 焦点导航、Enter 确认、Esc 关闭和系统复制／粘贴遵循控件惯例。Markdown 的 /、&gt; [!、··· 后回车属于输入语法；Ctrl + 滚轮用于代码字号缩放。</p></details>
  </div>;
}
