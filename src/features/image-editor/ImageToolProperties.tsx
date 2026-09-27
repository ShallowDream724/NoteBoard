import type { ImageEditOperation, ImageEditorTool } from './model';
import type { ToolStyle } from './toolDefaults';

interface Props {
  tool: ImageEditorTool; style: ToolStyle; selected?: ImageEditOperation; disabled: boolean;
  onChange(patch: Partial<ToolStyle>): void; ratio: number; onRatio(ratio: number): void; onResetCrop(): void;
  markerValue: number; onMarkerValue(value: number): void;
}
const TITLES: Record<ImageEditorTool, string> = { select: '选择标注', crop: '裁剪', pen: '铅笔', highlighter: '荧光笔', line: '箭头', polyline: '折线', rectangle: '矩形', ellipse: '椭圆', text: '文字', marker: '序号', mosaic: '马赛克', spotlight: '聚光灯', magnifier: '放大镜', eraser: '笔迹擦除', 'object-eraser': '对象擦除' };

export function ImageToolProperties({ tool, style, selected, disabled, onChange, ratio, onRatio, onResetCrop, markerValue, onMarkerValue }: Props) {
  const value: ToolStyle = { ...style, ...(selected && 'style' in selected ? selected.style : {}),
    ...(selected?.type === 'text' ? { color: selected.color, text: selected.text, fontSize: selected.fontSize, bold: !!selected.bold, italic: !!selected.italic } : {}),
    ...(selected?.type === 'marker' ? { markerSize: selected.size, markerFormat: selected.format, markerShape: selected.shape, markerAppearance: selected.appearance } : {}),
    ...(selected?.type === 'line' || selected?.type === 'polyline' ? { startHead: selected.startHead ?? 'none', endHead: selected.endHead ?? 'none' } : {}),
    ...(selected?.type === 'mosaic' ? { blockSize: selected.blockSize } : {}), ...(selected?.type === 'spotlight' ? { opacity: selected.opacity, spotlightShape: selected.shape } : {}),
    ...(selected?.type === 'magnifier' ? { radius: selected.radius, zoom: selected.zoom } : {}),
  };
  function number(key: keyof ToolStyle, label: string, min: number, max: number, step = 1) {
    return <label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={Number(value[key])} onChange={event => onChange({ [key]: Math.min(max, Math.max(min, Number(event.target.value) || min)) })}/></label>;
  }
  function select(key: keyof ToolStyle, label: string, choices: readonly (readonly [string, string])[]) {
    return <label key={key}>{label}<select aria-label={label} value={String(value[key])} onChange={event => onChange({ [key]: event.target.value })}>{choices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
  }
  const colored = ['pen', 'highlighter', 'line', 'polyline', 'rectangle', 'ellipse', 'text', 'marker', 'magnifier'].includes(tool);
  const stroked = ['pen', 'highlighter', 'line', 'polyline', 'rectangle', 'ellipse', 'marker', 'magnifier', 'eraser'].includes(tool);
  return <fieldset disabled={disabled} className="nb-ie-property-fields"><legend>{TITLES[tool]}</legend>
    {tool === 'select' && <p className="nb-ie-note">点击标注进行选择，拖动调整位置；右侧可修改样式。</p>}
    {colored && <label>颜色<div className="nb-ie-color"><input type="color" aria-label="标注颜色" value={value.color} onChange={event => onChange({ color: event.target.value })}/><span>{value.color.toUpperCase()}</span></div></label>}
    {stroked && number('width', '粗细 (px)', 1, 1000)}
    {['pen', 'line', 'polyline', 'rectangle', 'ellipse', 'marker', 'magnifier'].includes(tool) && select('pattern', '线型', [['solid', '实线'], ['dash', '虚线'], ['dashdot', '点划线']])}
    {(tool === 'line' || tool === 'polyline') && <>{select('startHead', '起点', [['none', '无箭头'], ['open', '空心箭头'], ['filled', '实心箭头']])}{select('endHead', '终点', [['none', '无箭头'], ['open', '空心箭头'], ['filled', '实心箭头']])}</>}
    {tool === 'text' && <><label className="nb-ie-stack">文字内容<textarea aria-label="文字内容" rows={4} value={value.text} placeholder="输入要放在图片上的文字" onChange={event => onChange({ text: event.target.value })}/></label>{number('fontSize', '字号 (px)', 6, 2000)}<div className="nb-ie-toggle-row"><button type="button" aria-label="文字加粗" aria-pressed={value.bold} onClick={() => onChange({ bold: !value.bold })}><b>B</b></button><button type="button" aria-label="文字倾斜" aria-pressed={value.italic} onClick={() => onChange({ italic: !value.italic })}><i>I</i></button></div></>}
    {tool === 'marker' && <><label>{selected ? '当前序号' : '下一序号'}<input aria-label="序号数值" type="number" min={1} max={999999} value={markerValue} onChange={event => onMarkerValue(Math.max(1, Math.min(999999, Number(event.target.value) || 1)))}/></label>{select('markerFormat', '编号', [['decimal', '1, 2, 3'], ['roman', 'I, II, III'], ['alpha', 'A, B, C']])}{select('markerShape', '形状', [['circle', '圆形'], ['square', '方形']])}{select('markerAppearance', '样式', [['filled', '实心'], ['outlined', '空心'], ['ring', '双层边框']])}{number('markerSize', '大小 (px)', 12, 2000)}</>}
    {tool === 'mosaic' && number('blockSize', '马赛克颗粒 (px)', 2, 500)}
    {tool === 'spotlight' && <>{select('spotlightShape', '形状', [['ellipse', '椭圆'], ['rectangle', '矩形']])}{number('opacity', '周围暗度', 0, .95, .05)}</>}
    {tool === 'magnifier' && <>{number('radius', '半径 (px)', 10, 2000)}{number('zoom', '放大倍数', 1.1, 20, .1)}</>}
    {tool === 'crop' && <><label>比例<select aria-label="裁剪比例" value={ratio} onChange={event => onRatio(Number(event.target.value))}><option value={0}>自由</option><option value={1}>1 : 1</option><option value={4 / 3}>4 : 3</option><option value={3 / 2}>3 : 2</option><option value={16 / 9}>16 : 9</option><option value={9 / 16}>9 : 16</option></select></label><p className="nb-ie-note">在图片上拖动选择范围，松开完成裁剪。旋转和镜像同样作用于标注。</p><button type="button" onClick={onResetCrop}>恢复完整画幅</button></>}
    {tool === 'object-eraser' && <p className="nb-ie-note">点击或划过标注将其移除，原图保持不变。</p>}
    {tool === 'eraser' && <p className="nb-ie-note">擦过的区域恢复原图，可撤销。</p>}
  </fieldset>;
}
