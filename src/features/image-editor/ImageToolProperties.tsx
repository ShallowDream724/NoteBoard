import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMarkerValue, type ArrowHead, type ImageEditOperation, type ImageEditorTool, type LinePattern, type MarkerAppearance, type MarkerShape } from './model';
import type { ToolStyle } from './toolDefaults';
import './imageToolProperties.css';

interface Props {
  tool: ImageEditorTool; style: ToolStyle; selected?: ImageEditOperation; disabled: boolean;
  onChange(patch: Partial<ToolStyle>): void; ratio: number; onRatio(ratio: number): void; onResetCrop(): void;
  markerValue: number; onMarkerValue(value: number): void;
  nextMarkerValue?: number; onNextMarkerValue?(value: number): void;
  onBeginChange?(): void; onEndChange?(): void;
  mosaicMode?: 'brush' | 'rectangle'; onMosaicMode?(mode: 'brush' | 'rectangle'): void;
  magnifierShape?: 'circle' | 'ellipse'; onMagnifierShape?(shape: 'circle' | 'ellipse'): void;
  cropSize?: { width: number; height: number }; onApplyCrop?(): void; onCancelCrop?(): void;
}
const TITLES: Record<ImageEditorTool, string> = { select: '选择标注', crop: '裁剪', pen: '铅笔', highlighter: '荧光笔', line: '箭头', polyline: '折线', rectangle: '矩形', ellipse: '椭圆', text: '文字', marker: '序号', mosaic: '马赛克', 'mosaic-brush': '马赛克', spotlight: '聚光灯', magnifier: '放大镜', eraser: '笔迹擦除', 'object-eraser': '对象擦除' };
const COLORS = [
  ['#ef4444', '红色'], ['#facc15', '黄色'], ['#3b82f6', '蓝色'], ['#22c55e', '绿色'],
  ['#111827', '黑色'], ['#ffffff', '白色'], ['#a855f7', '紫色'], ['#ec4899', '粉色'],
] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface NumberControlProps {
  label: string; value: number; min: number; max: number; sliderMin?: number; sliderMax?: number;
  step?: number; unit?: string; onChange(value: number): void; onBeginChange?(): void; onEndChange?(): void;
}
function NumberControl({ label, value, min, max, sliderMin = min, sliderMax = Math.min(max, 100), step = 1, unit = '', onChange, onBeginChange, onEndChange }: NumberControlProps) {
  const displayed = Number(value.toFixed(2));
  const [draft, setDraft] = useState(String(displayed));
  const [editing, setEditing] = useState(false);
  const changing = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(displayed)); }, [displayed, editing]);
  const begin = () => { if (!changing.current) { changing.current = true; onBeginChange?.(); } };
  const end = () => { if (changing.current) { changing.current = false; onEndChange?.(); } };
  const finishDraft = () => {
    const parsed = Number(draft);
    const next = draft.trim() && Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    if (next !== value) onChange(next);
    setDraft(String(next)); setEditing(false); end();
  };
  const rangeKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  return <div className="nb-ie-number-control">
    <div className="nb-ie-control-heading"><span>{label}</span><span className="nb-ie-control-unit">{unit}</span></div>
    <div className="nb-ie-number-row">
      <input aria-label={`${label}滑块`} title={`滑块范围 ${sliderMin}–${sliderMax}${unit}；右侧可输入 ${min}–${max}${unit}`} type="range" min={sliderMin} max={sliderMax} step={step} value={clamp(value, sliderMin, sliderMax)}
        onChange={event => onChange(Number(event.target.value))}
        onPointerDown={begin} onPointerUp={end} onPointerCancel={end} onBlur={end}
        onKeyDown={event => { if (rangeKeys.includes(event.key)) begin(); }} onKeyUp={event => { if (rangeKeys.includes(event.key)) end(); }}/>
      <input aria-label={`${label}${unit ? ` (${unit})` : ''}`} title={`可输入 ${min}–${max}${unit}`} type="number" min={min} max={max} step={step} value={editing ? draft : displayed}
        onFocus={() => { setEditing(true); setDraft(String(displayed)); begin(); }}
        onChange={event => { const text = event.target.value; setDraft(text); const n = Number(text); if (text.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n); }}
        onBlur={finishDraft} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
    </div>
  </div>;
}

function OptionGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string, ReactNode])[]; onChange(value: T): void }) {
  return <div className="nb-ie-option-group"><div className="nb-ie-control-heading">{label}</div><div className="nb-ie-options" role="group" aria-label={label}>
    {options.map(([option, title, icon]) => <button key={option} type="button" aria-label={`${label}：${title}`} title={title} aria-pressed={value === option} onClick={() => onChange(option)}><span className="nb-ie-option-icon" aria-hidden="true">{icon}</span><span>{title}</span></button>)}
  </div></div>;
}
function ShapeIcon({ shape }: { shape: 'circle' | 'ellipse' | 'square' | 'rectangle' }) {
  return <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{shape === 'circle' ? <circle cx="16" cy="12" r="9"/> : shape === 'ellipse' ? <ellipse cx="16" cy="12" rx="13" ry="8"/> : <rect x={shape === 'square' ? 7 : 3} y={3} width={shape === 'square' ? 18 : 26} height={18} rx="1"/>}</svg>;
}
function PatternIcon({ pattern }: { pattern: LinePattern }) {
  return <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M2 12 H30" strokeDasharray={pattern === 'dash' ? '7 5' : pattern === 'dashdot' ? '9 4 1 4' : undefined}/></svg>;
}
function ArrowIcon({ head }: { head: ArrowHead }) {
  return <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12 H25"/>{head !== 'none' && <path d="M23 5 L30 12 L23 19" fill={head === 'filled' ? 'currentColor' : 'none'}/>}</svg>;
}
function AppearanceIcon({ shape, appearance }: { shape: MarkerShape; appearance: MarkerAppearance }) {
  const form = shape === 'circle' ? <circle cx="16" cy="12" r="9"/> : <rect x="7" y="3" width="18" height="18"/>;
  const inner = shape === 'circle' ? <circle cx="16" cy="12" r="5"/> : <rect x="11" y="7" width="10" height="10"/>;
  return <svg viewBox="0 0 32 24" fill={appearance === 'filled' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">{form}{appearance === 'ring' && inner}</svg>;
}
function MosaicIcon({ mode }: { mode: 'brush' | 'rectangle' }) {
  return <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{mode === 'brush' ? <><path d="M3 18 Q12 4 19 13 T29 6" strokeLinecap="round"/><path d="M5 21 H9 M16 18 H20 M25 13 H29"/></> : <rect x="4" y="3" width="24" height="18"/>}</svg>;
}

export function ImageToolProperties({ tool, style, selected, disabled, onChange, ratio, onRatio, onResetCrop, markerValue, onMarkerValue, nextMarkerValue, onNextMarkerValue, onBeginChange, onEndChange, mosaicMode = 'rectangle', onMosaicMode, magnifierShape = 'circle', onMagnifierShape, cropSize, onApplyCrop, onCancelCrop }: Props) {
  const value: ToolStyle = { ...style, ...(selected && 'style' in selected ? selected.style : {}),
    ...(selected?.type === 'text' ? { color: selected.color, text: selected.text, fontSize: selected.fontSize, bold: !!selected.bold, italic: !!selected.italic } : {}),
    ...(selected?.type === 'marker' ? { markerSize: selected.size, markerFormat: selected.format, markerShape: selected.shape, markerAppearance: selected.appearance } : {}),
    ...(selected?.type === 'line' || selected?.type === 'polyline' ? { startHead: selected.startHead ?? 'none', endHead: selected.endHead ?? 'none' } : {}),
    ...(selected?.type === 'mosaic' || selected?.type === 'mosaic-brush' ? { blockSize: selected.blockSize, ...(selected.type === 'mosaic-brush' ? { width: selected.width } : {}) } : {}),
    ...(selected?.type === 'spotlight' ? { opacity: selected.opacity, spotlightShape: selected.shape } : {}),
    ...(selected?.type === 'magnifier' ? { radius: selected.radius, zoom: selected.zoom } : {}),
  };
  const number = (key: keyof ToolStyle, label: string, min: number, max: number, sliderMin = min, sliderMax = 100, step = 1, unit = 'px', transform?: { toDisplay: (value: number) => number; fromDisplay: (value: number) => number }) =>
    <NumberControl key={key} label={label} value={transform ? transform.toDisplay(Number(value[key])) : Number(value[key])} min={min} max={max} sliderMin={sliderMin} sliderMax={sliderMax} step={step} unit={unit}
      onChange={next => onChange({ [key]: transform ? transform.fromDisplay(next) : next })} onBeginChange={onBeginChange} onEndChange={onEndChange}/>;
  const colored = ['pen', 'highlighter', 'line', 'polyline', 'rectangle', 'ellipse', 'text', 'marker', 'magnifier'].includes(tool);
  const stroked = ['pen', 'highlighter', 'line', 'polyline', 'rectangle', 'ellipse', 'marker', 'magnifier', 'eraser'].includes(tool);
  const patternOptions = (['solid', 'dash', 'dashdot'] as const).map((pattern, index) => [pattern, ['实线', '虚线', '点划线'][index], <PatternIcon pattern={pattern}/>] as const);
  const arrowOptions = (['none', 'open', 'filled'] as const).map((head, index) => [head, ['无', '空心', '实心'][index], <ArrowIcon head={head}/>] as const);
  const activeMosaicMode = selected?.type === 'mosaic-brush' || tool === 'mosaic-brush' ? 'brush' : selected?.type === 'mosaic' ? 'rectangle' : mosaicMode;
  const activeMagnifierShape = selected?.type === 'magnifier'
    ? selected.rect && Math.abs(selected.rect.width - selected.rect.height) > 1 ? 'ellipse' : 'circle'
    : magnifierShape;
  const shownMarkerValue = selected?.type === 'marker' ? markerValue : nextMarkerValue ?? markerValue;
  const setShownMarkerValue = selected?.type === 'marker' ? onMarkerValue : onNextMarkerValue ?? onMarkerValue;
  return <fieldset disabled={disabled} className="nb-ie-property-fields"><legend>{TITLES[tool]}</legend>
    {colored && <div className="nb-ie-color-control"><div className="nb-ie-control-heading">颜色</div><div className="nb-ie-swatches" role="group" aria-label="标注颜色">
      {COLORS.map(([color, name]) => <button key={color} type="button" className="nb-ie-swatch" aria-label={name} title={name} aria-pressed={value.color.toLowerCase() === color} style={{ backgroundColor: color }} onClick={() => onChange({ color })}/>)}
      <label className="nb-ie-custom-color" title="自定义颜色"><input type="color" aria-label="自定义颜色" value={value.color} onChange={event => onChange({ color: event.target.value })}/><span aria-hidden="true">＋</span></label>
    </div></div>}
    {stroked && number('width', '粗细', 1, 1000)}
    {['pen', 'line', 'polyline', 'rectangle', 'ellipse', 'marker', 'magnifier'].includes(tool) && <OptionGroup label="线型" value={value.pattern} options={patternOptions} onChange={pattern => onChange({ pattern })}/>}
    {(tool === 'line' || tool === 'polyline') && <><OptionGroup label="起点箭头" value={value.startHead} options={arrowOptions} onChange={startHead => onChange({ startHead })}/><OptionGroup label="终点箭头" value={value.endHead} options={arrowOptions} onChange={endHead => onChange({ endHead })}/></>}
    {tool === 'text' && <><label className="nb-ie-stack">文字内容<textarea aria-label="文字内容" rows={4} value={value.text} placeholder="点击画布输入文字" onChange={event => onChange({ text: event.target.value })}/></label>{number('fontSize', '字号', 1, 2000)}<div className="nb-ie-toggle-row"><button type="button" aria-label="文字加粗" title="加粗" aria-pressed={value.bold} onClick={() => onChange({ bold: !value.bold })}><b>B</b></button><button type="button" aria-label="文字倾斜" title="倾斜" aria-pressed={value.italic} onClick={() => onChange({ italic: !value.italic })}><i>I</i></button></div></>}
    {tool === 'marker' && <><label>{selected?.type === 'marker' ? '当前序号' : '下一序号'}<input aria-label={selected?.type === 'marker' ? '当前序号' : '下一序号'} type="number" min={1} max={999999} value={shownMarkerValue} onChange={event => setShownMarkerValue(clamp(Number(event.target.value) || 1, 1, 999999))}/></label>{selected?.type === 'marker' && nextMarkerValue !== undefined && <label>下一序号<input aria-label="下一序号" type="number" min={1} max={999999} value={nextMarkerValue} onChange={event => (onNextMarkerValue ?? onMarkerValue)(clamp(Number(event.target.value) || 1, 1, 999999))}/></label>}<label>编号<select aria-label="编号格式" value={value.markerFormat} onChange={event => onChange({ markerFormat: event.target.value as ToolStyle['markerFormat'] })}><option value="decimal">1, 2, 3</option><option value="roman">I, II, III</option><option value="alpha">A, B, C</option></select></label><OptionGroup label="形状" value={value.markerShape} options={[[ 'circle', '圆形', <ShapeIcon shape="circle"/> ], [ 'square', '方形', <ShapeIcon shape="square"/> ]]} onChange={markerShape => onChange({ markerShape })}/><OptionGroup label="样式" value={value.markerAppearance} options={(['filled', 'outlined', 'ring'] as const).map((appearance, index) => [appearance, ['实心', '空心', '双圈'][index], <AppearanceIcon shape={value.markerShape} appearance={appearance}/>] as const)} onChange={markerAppearance => onChange({ markerAppearance })}/><div className="nb-ie-marker-preview"><span>效果</span><span className={`nb-ie-marker-sample nb-ie-marker-${value.markerShape} nb-ie-marker-${value.markerAppearance}`} style={{ color: value.color }}><span>{formatMarkerValue(shownMarkerValue, value.markerFormat)}</span></span></div>{number('markerSize', '大小', 1, 2000)}</>}
    {(tool === 'mosaic' || tool === 'mosaic-brush') && <><OptionGroup label="绘制方式" value={activeMosaicMode} options={[[ 'brush', '画笔', <MosaicIcon mode="brush"/> ], [ 'rectangle', '矩形', <MosaicIcon mode="rectangle"/> ]]} onChange={mode => onMosaicMode?.(mode)}/>{activeMosaicMode === 'brush' && number('width', '画笔粗细', 1, 1000)}{number('blockSize', '颗粒大小', 2, 500, 2)}</>}
    {tool === 'spotlight' && <><OptionGroup label="形状" value={value.spotlightShape} options={[[ 'ellipse', '椭圆', <ShapeIcon shape="ellipse"/> ], [ 'rectangle', '矩形', <ShapeIcon shape="rectangle"/> ]]} onChange={spotlightShape => onChange({ spotlightShape })}/>{number('opacity', '周围暗度', 0, 100, 0, 100, 1, '%', { toDisplay: n => Math.round(n * 100), fromDisplay: n => n / 100 })}</>}
    {tool === 'magnifier' && <><OptionGroup label="形状" value={activeMagnifierShape} options={[[ 'circle', '圆形', <ShapeIcon shape="circle"/> ], [ 'ellipse', '椭圆', <ShapeIcon shape="ellipse"/> ]]} onChange={shape => onMagnifierShape?.(shape)}/>{number('zoom', '放大倍数', 1.1, 20, 1.1, 10, .1, '×')}{!selected && activeMagnifierShape === 'circle' && number('radius', '初始半径', 1, 2000)}</>}
    {tool === 'crop' && <><label>比例<select aria-label="裁剪比例" value={ratio} onChange={event => onRatio(Number(event.target.value))}><option value={0}>自由</option><option value={1}>1 : 1</option><option value={4 / 3}>4 : 3</option><option value={3 / 2}>3 : 2</option><option value={16 / 9}>16 : 9</option><option value={9 / 16}>9 : 16</option></select></label>{cropSize && <div className="nb-ie-crop-size" aria-label="裁剪尺寸">{Math.round(cropSize.width)} × {Math.round(cropSize.height)} px</div>}<div className="nb-ie-crop-actions">{onCancelCrop && <button type="button" onClick={onCancelCrop}>取消</button>}{onApplyCrop && <button type="button" className="nb-ie-crop-apply" onClick={onApplyCrop}>应用裁剪</button>}</div><button type="button" onClick={onResetCrop}>恢复完整画幅</button></>}
  </fieldset>;
}
