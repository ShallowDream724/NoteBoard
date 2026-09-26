import { useState } from 'react';
import { Shuffle, RotateCcw } from 'lucide-react';
import { ColorSwatches } from '../document-style/ColorSwatches';
import { ALERT_CHOICES, ALERT_META } from './alertPresentation';
import { CALLOUT_BACKGROUNDS, CALLOUT_EMOJI, calloutTitle, isCalloutIcon, type CalloutAttributes } from './calloutPresentation';

export default function CalloutMenu({ attrs, mode, nativeVisible, onChange }: {
  attrs: CalloutAttributes; mode: 'appearance' | 'icon'; nativeVisible: boolean; onChange: (patch: Partial<CalloutAttributes>) => void;
}) {
  const [title, setTitle] = useState(calloutTitle(attrs));
  const [emoji, setEmoji] = useState('');
  const [scope, setScope] = useState<'textColor' | 'borderColor' | 'backgroundColor'>('backgroundColor');
  const label = { textColor: '文字', borderColor: '边框', backgroundColor: '背景' }[scope];
  if (mode === 'icon') return <>
    <div className="callout-menu-heading">提示块图标</div>
    <div className="callout-icon-options" role="group" aria-label="预设图标">
      {ALERT_CHOICES.map(item => <button key={item.kind} type="button" title={ALERT_META[item.kind].label}
        aria-label={ALERT_META[item.kind].label} aria-pressed={(attrs.icon ?? attrs.kind) === item.kind}
        onClick={() => onChange({ kind: item.kind, icon: null })}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ALERT_META[item.kind].icon}/></svg>
      </button>)}
    </div>
    {nativeVisible && <>
      <div className="callout-icon-options" role="group" aria-label="常用表情">{CALLOUT_EMOJI.map(icon => <button type="button" key={icon}
        aria-label={'图标 ' + icon} aria-pressed={attrs.icon === icon} onClick={() => onChange({ icon })}>{icon}</button>)}</div>
      <form className="callout-emoji-input" onSubmit={event => { event.preventDefault(); if (emoji && isCalloutIcon(emoji)) onChange({ icon: emoji }); }}>
        <input aria-label="输入表情图标" placeholder="粘贴一个 emoji" maxLength={32} value={emoji} onChange={event => setEmoji(event.target.value)}/>
        <button type="submit" disabled={!emoji || !isCalloutIcon(emoji)}>使用</button>
      </form>
      <button type="button" className="callout-menu-action" onClick={() => onChange({ icon: null })}>恢复预设图标</button>
    </>}
  </>;
  return <>
    <div className="callout-menu-heading">提示块外观</div>
    {nativeVisible && <>
      <label className="callout-title-field">标题<input aria-label="提示块标题" placeholder="无标题" maxLength={500} value={title}
        onChange={event => setTitle(event.target.value)} onBlur={() => { if (title !== calloutTitle(attrs)) onChange({ title }); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange({ title }); } }}/></label>
      <div className="callout-title-actions"><button type="button" onClick={() => { setTitle(''); onChange({ title: '' }); }}>隐藏标题</button>
        <button type="button" onClick={() => { setTitle(ALERT_META[attrs.kind].label); onChange({ title: null }); }}>预设标题</button></div>
      <div className="callout-color-tabs" role="group" aria-label="颜色范围">
        {(['textColor', 'borderColor', 'backgroundColor'] as const).map(key => <button type="button" key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>
          {{ textColor: '文字', borderColor: '边框', backgroundColor: '背景' }[key]}</button>)}
      </div>
      <ColorSwatches label={label + '颜色'} kind={scope === 'backgroundColor' ? 'background' : scope === 'borderColor' ? 'border' : 'text'} value={attrs[scope]} onChange={value => onChange({ [scope]: value })}/>
      <label className="callout-custom-color">自定义{label}<input type="color" aria-label={'自定义' + label + '颜色'} value={attrs[scope] ?? (scope === 'backgroundColor' ? '#eff6ff' : '#64748b')}
        onChange={event => onChange({ [scope]: event.target.value })}/></label>
      <div className="callout-menu-actions"><button type="button" onClick={() => {
        const choices = CALLOUT_BACKGROUNDS.filter(value => value !== attrs.backgroundColor);
        onChange({ backgroundColor: choices[Math.floor(Math.random() * choices.length)] });
      }}><Shuffle size={14}/>随机背景</button><button type="button" onClick={() => onChange({ textColor: null, borderColor: null, backgroundColor: null })}><RotateCcw size={14}/>重置颜色</button></div>
    </>}
  </>;
}
