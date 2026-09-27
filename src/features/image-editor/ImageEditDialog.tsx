import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Circle, Crop, Eraser, FlipHorizontal2, FlipVertical2, Focus, Hash, Highlighter, LayoutGrid, Maximize, Minus, MousePointer2, Pencil, Plus, Redo2, RotateCw, Save, Square, Trash2, Type, Undo2, Waypoints, X, ZoomIn } from 'lucide-react';
import { commitImageEdit, redoImageEdit, undoImageEdit, type ImageEditHistory, type ImageEditOperation, type ImageEditRecipe, type ImageEditorTool, type Point, type Rect } from './model';
import { constrainCrop, getOperationBounds, getOutputSize, hitTestOperation, normalizeRect, outputToSource, sourceToOutput, translateOperation } from './geometry';
import { exportImageEdit, getImageExportSize, LargeImageExportConfirmationError, type ImageExportMimeType } from './exporter';
import { loadImageResource, releaseCanvas, type ImageResource } from './resources';
import { renderImageEdit } from './renderer';
import { acquireImageEditorDraft, discardImageEditorDraft, hasImageEditorDraft, updateImageEditorDraft } from './sessions';
import { createToolOperation, DEFAULT_TOOL_STYLE, restyleOperation, type ToolStyle } from './toolDefaults';
import { ImageToolProperties } from './ImageToolProperties';
import type { ImageEditorController, ImageEditorOptions } from './types';
import './imageEditor.css';

const TOOLS = [
  ['select', '选择', MousePointer2], ['crop', '裁剪', Crop], ['pen', '铅笔', Pencil], ['highlighter', '荧光笔', Highlighter],
  ['line', '箭头', ArrowUpRight], ['polyline', '折线', Waypoints], ['rectangle', '矩形', Square], ['ellipse', '椭圆', Circle],
  ['text', '文字', Type], ['marker', '序号', Hash], ['mosaic', '马赛克', LayoutGrid], ['spotlight', '聚光灯', Focus],
  ['magnifier', '放大镜', ZoomIn], ['eraser', '笔迹擦除', Eraser], ['object-eraser', '对象擦除', Trash2],
] as const;
interface Gesture { tool: ImageEditorTool; start: Point; base: ImageEditRecipe; preview: ImageEditRecipe; operation?: ImageEditOperation; original?: ImageEditOperation; points?: Point[]; crop?: Rect }
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable=true]'));

export function ImageEditDialog({ options, register, close }: { options: ImageEditorOptions; register(controller: ImageEditorController): void; close(): void }) {
  const [history, setHistory] = useState<ImageEditHistory | null>(null);
  const historyRef = useRef<ImageEditHistory | null>(null);
  const resource = useRef<ImageResource | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tool, setTool] = useState<ImageEditorTool>('select');
  const [style, setStyle] = useState<ToolStyle>(DEFAULT_TOOL_STYLE);
  const strokeWidths = useRef<Partial<Record<ImageEditorTool, number>>>({ highlighter: 24, eraser: 20 });
  const [selected, setSelected] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0), [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 800, height: 550 });
  const [mime, setMime] = useState<ImageExportMimeType>('image/png'), [quality, setQuality] = useState(92), [scale, setScale] = useState(100);
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [large, setLarge] = useState('');
  const [writing, setWriting] = useState(false);
  const alive = useRef(true), exportAbort = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef(0), draw = useRef<() => void>(() => {});
  const apply = (next: ImageEditHistory) => { historyRef.current = next; updateImageEditorDraft(options.key, next); setHistory(next); };
  const commit = (recipe: ImageEditRecipe, nextMarker?: number) => { if (historyRef.current) apply(commitImageEdit(historyRef.current, recipe, nextMarker)); };
  const repaint = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; draw.current(); }); };
  const finishGesture = (keep = true) => {
    const current = gesture.current; gesture.current = null;
    if (!current) return;
    if (keep) {
      if (current.crop && current.crop.width >= 1 && current.crop.height >= 1) commit({ ...current.base, crop: current.crop });
      else if (current.preview !== current.base) commit(current.preview);
    }
    repaint();
  };
  const runtime = useRef({ finishGesture }); runtime.current = { finishGesture };

  useEffect(() => {
    const abort = new AbortController(); alive.current = true;
    register({ suspend() { runtime.current.finishGesture(); exportAbort.current?.abort(); abort.abort(); } });
    void loadImageResource(options.src, abort.signal).then(image => {
      if (abort.signal.aborted) { image.dispose(); return; }
      try { const initial = acquireImageEditorDraft(options.key, image.width, image.height); resource.current = image; historyRef.current = initial; setHistory(initial); }
      catch (failure) { image.dispose(); setError(String(failure)); }
      setLoading(false);
    }).catch(failure => { if (!abort.signal.aborted) { setError(String(failure)); setLoading(false); } });
    return () => { alive.current = false; abort.abort(); exportAbort.current?.abort(); if (frame.current) cancelAnimationFrame(frame.current); resource.current?.dispose(); resource.current = null; if (canvas.current) releaseCanvas(canvas.current); };
  }, [options.key, options.src, register]);

  useEffect(() => {
    const element = stage.current; if (!element) return;
    const resize = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
  }, []);

  const recipe = history?.present.recipe;
  const hasRecipe = !!recipe;
  useEffect(() => { const target = canvas.current; return () => { if (target) releaseCanvas(target); }; }, [hasRecipe]);
  const size = recipe ? getOutputSize(recipe) : { width: 800, height: 550 };
  const fit = Math.max(.001, Math.min(1, (viewport.width - 48) / size.width, (viewport.height - 48) / size.height));
  const displayWidth = Math.max(1, size.width * fit * zoom), displayHeight = Math.max(1, size.height * fit * zoom);
  const selectedOperation = recipe?.operations.find(operation => operation.id === selected);
  const activeTool = tool === 'select' && selectedOperation ? selectedOperation.type : tool;

  draw.current = () => {
    const target = canvas.current, image = resource.current, current = gesture.current?.preview ?? historyRef.current?.present.recipe;
    if (!target || !image || !current) return;
    const density = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(displayWidth, displayHeight));
    const width = Math.max(1, Math.round(displayWidth * density)), height = Math.max(1, Math.round(displayHeight * density));
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const context = target.getContext('2d'); if (!context) return;
    renderImageEdit(context, image, current);
    const outline = gesture.current?.crop ?? (selected ? getOperationBounds(current.operations.find(operation => operation.id === selected) ?? { id: '', type: 'rectangle', rect: { x: 0, y: 0, width: 0, height: 0 }, style: { color: '', width: 1, pattern: 'solid' } }) : null);
    if (outline && outline.width && outline.height) {
      const out = getOutputSize(current), corners = [{ x: outline.x, y: outline.y }, { x: outline.x + outline.width, y: outline.y }, { x: outline.x + outline.width, y: outline.y + outline.height }, { x: outline.x, y: outline.y + outline.height }].map(point => sourceToOutput(point, current));
      context.save(); context.lineWidth = Math.max(1, density * 1.5); context.strokeStyle = '#3b82f6'; context.setLineDash([5 * density, 4 * density]); context.beginPath();
      corners.forEach((point, index) => { const x = point.x * width / out.width, y = point.y * height / out.height; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
      context.closePath(); context.stroke(); context.restore();
    }
  };
  useEffect(() => { repaint(); });

  function location(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const box = event.currentTarget.getBoundingClientRect(), current = historyRef.current!.present.recipe, out = getOutputSize(current);
    return outputToSource({ x: Math.max(0, Math.min(out.width, (event.clientX - box.left) / box.width * out.width)), y: Math.max(0, Math.min(out.height, (event.clientY - box.top) / box.height * out.height)) }, current);
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (busy || !historyRef.current || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const point = location(event), base = historyRef.current.present.recipe;
    if (tool === 'polyline' && gesture.current?.tool === 'polyline') { gesture.current.points!.push(point); repaint(); return; }
    if (tool === 'select' || tool === 'object-eraser') {
      const hit = [...base.operations].reverse().find(operation => hitTestOperation(point, operation, 6 / (fit * zoom)));
      setSelected(tool === 'select' ? hit?.id ?? null : null);
      if (!hit) return;
      gesture.current = { tool, start: point, base, preview: tool === 'object-eraser' ? { ...base, operations: base.operations.filter(operation => operation !== hit) } : base, original: hit };
    } else if (tool === 'crop') { setSelected(null); gesture.current = { tool, start: point, base, preview: base }; }
    else {
      const operation = createToolOperation(tool, point, style, historyRef.current.present.nextMarker);
      if (!operation) { if (tool === 'text') setError('先在右侧输入文字，再点击图片放置。'); return; }
      setError(''); setSelected(null);
      if (tool === 'marker' || tool === 'text' || tool === 'magnifier') {
        commit({ ...base, operations: [...base.operations, operation] }, tool === 'marker' ? historyRef.current.present.nextMarker + 1 : undefined); setSelected(tool === 'text' ? operation.id : null); return;
      }
      const points = 'points' in operation ? [...operation.points] : undefined;
      const drawing = points ? { ...operation, points } as ImageEditOperation : operation;
      gesture.current = { tool, start: point, base, preview: { ...base, operations: [...base.operations, drawing] }, operation: drawing, points };
    }
    event.currentTarget.setPointerCapture(event.pointerId); repaint();
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = gesture.current; if (!current || busy || !historyRef.current) return;
    const point = location(event);
    if (current.tool === 'select' && current.original) {
      const moved = translateOperation(current.original, point.x - current.start.x, point.y - current.start.y);
      current.preview = { ...current.base, operations: current.base.operations.map(operation => operation.id === moved.id ? moved : operation) };
    } else if (current.tool === 'object-eraser') {
      current.preview = { ...current.preview, operations: current.preview.operations.filter(operation => !hitTestOperation(point, operation, 8 / (fit * zoom))) };
    } else if (current.tool === 'crop') {
      current.crop = constrainCrop(normalizeRect(current.start, point), current.base.sourceWidth, current.base.sourceHeight, ratio ? current.base.rotation % 2 ? 1 / ratio : ratio : undefined);
    } else if (current.operation) {
      if (current.points) {
        if (current.tool === 'line' || current.tool === 'polyline') current.points[current.points.length - 1] = point;
        else if (Math.hypot(point.x - current.points.at(-1)!.x, point.y - current.points.at(-1)!.y) >= .5 / (fit * zoom)) current.points.push(point);
      } else if ('rect' in current.operation) {
        current.operation = { ...current.operation, rect: normalizeRect(current.start, point) };
        current.preview = { ...current.base, operations: [...current.base.operations, current.operation] };
      }
    }
    repaint();
  }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.current?.tool !== 'polyline') finishGesture();
  }
  function choose(next: ImageEditorTool) { finishGesture(); setSelected(null); setTool(next); setError(''); setStyle(value => ({ ...value, width: strokeWidths.current[next] ?? 4 })); }
  function changeStyle(patch: Partial<ToolStyle>) {
    if (patch.width !== undefined) strokeWidths.current[activeTool] = patch.width;
    setStyle(value => ({ ...value, ...patch }));
    const current = historyRef.current?.present.recipe;
    if (selected && current) commit({ ...current, operations: current.operations.map(operation => operation.id === selected ? restyleOperation(operation, patch) : operation) });
  }
  function removeSelected() {
    const current = historyRef.current?.present.recipe;
    if (selected && current) { commit({ ...current, operations: current.operations.filter(operation => operation.id !== selected) }); setSelected(null); }
  }
  function undo() { finishGesture(false); if (historyRef.current) apply(undoImageEdit(historyRef.current)); setSelected(null); }
  function redo() { finishGesture(false); if (historyRef.current) apply(redoImageEdit(historyRef.current)); setSelected(null); }
  function requestClose() { if (saving.current) return; finishGesture(); if (busy) { exportAbort.current?.abort(); setBusy(false); return; } if (hasImageEditorDraft(options.key)) setClosing(true); else { discardImageEditorDraft(options.key); close(); } }
  async function save(allowLargeExport = false) {
    finishGesture(); const current = historyRef.current?.present.recipe, image = resource.current; if (!current || !image || busy) return;
    const abort = new AbortController(); exportAbort.current = abort; setBusy(true); setError(''); setLarge('');
    try {
      const output = getOutputSize(current), width = Math.max(1, Math.round(output.width * scale / 100));
      const settings = { mimeType: mime, quality: quality / 100, width, signal: abort.signal, allowLargeExport };
      const blob = await exportImageEdit(image, current, settings);
      if (!alive.current || abort.signal.aborted) return;
      // A native file write is atomic once started. A suspended document target
      // still cancels its pending reference replacement through this signal.
      saving.current = true;
      setWriting(true);
      const accepted = await options.onSave(blob, { ...getImageExportSize(current, settings), mimeType: mime, extension: mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp' }, abort.signal);
      if (!alive.current || abort.signal.aborted || accepted === false) return;
      discardImageEditorDraft(options.key); close();
    } catch (failure) {
      if (alive.current && !abort.signal.aborted) {
        if (failure instanceof LargeImageExportConfirmationError) setLarge(failure.message);
        else setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally { saving.current = false; if (alive.current) { setBusy(false); setWriting(false); } }
  }
  const shortcuts = (event: React.KeyboardEvent) => {
    if (isTyping(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (!busy) { if (event.shiftKey) redo(); else undo(); } }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); if (!busy) redo(); }
    else if (event.key === 'Enter' && gesture.current?.tool === 'polyline') { event.preventDefault(); finishGesture(); }
    else if (!busy && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeSelected(); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="nb-ie-backdrop" /><Dialog.Content className="nb-ie-dialog" data-shortcuts-suspended onKeyDown={shortcuts} onCloseAutoFocus={event => event.preventDefault()}
      onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); if (gesture.current) finishGesture(false); else if (closing) setClosing(false); else requestClose(); }}>
      <header className="nb-ie-header"><div><Dialog.Title>编辑图片</Dialog.Title><Dialog.Description>{options.name || '图片'}</Dialog.Description></div>
        <div className="nb-ie-actions"><button title="撤销 Ctrl+Z" aria-label="撤销图片编辑" disabled={!history?.past.length || busy} onClick={undo}><Undo2 size={18}/></button><button title="重做 Ctrl+Shift+Z" aria-label="重做图片编辑" disabled={!history?.future.length || busy} onClick={redo}><Redo2 size={18}/></button><span className="nb-ie-divider"/><button title="顺时针旋转" aria-label="顺时针旋转" disabled={!recipe || busy} onClick={() => { finishGesture(); const r = historyRef.current!.present.recipe; commit({ ...r, rotation: ((r.rotation + 1) % 4) as 0 | 1 | 2 | 3 }); }}><RotateCw size={18}/></button><button title="水平镜像" aria-label="水平镜像" disabled={!recipe || busy} onClick={() => { finishGesture(); const r = historyRef.current!.present.recipe; commit({ ...r, flipX: !r.flipX }); }}><FlipHorizontal2 size={18}/></button><button title="垂直镜像" aria-label="垂直镜像" disabled={!recipe || busy} onClick={() => { finishGesture(); const r = historyRef.current!.present.recipe; commit({ ...r, flipY: !r.flipY }); }}><FlipVertical2 size={18}/></button><span className="nb-ie-divider"/><button aria-label="关闭图片编辑" disabled={writing} title={busy && !writing ? '取消导出' : '关闭'} onClick={requestClose}><X size={20}/></button></div>
      </header>
      <div className="nb-ie-body"><nav className="nb-ie-tools" aria-label="图片编辑工具">{TOOLS.map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} aria-pressed={tool === value} disabled={!recipe || busy} onClick={() => choose(value)}><Icon size={19}/><span>{label}</span></button>)}</nav>
        <div className="nb-ie-stage" ref={stage}>{loading ? <div className="nb-ie-loading">正在打开图片…</div> : recipe && <div className="nb-ie-canvas-wrap" style={{ width: displayWidth, height: displayHeight }}><canvas ref={canvas} tabIndex={0} aria-label="图片编辑画布" style={{ width: displayWidth, height: displayHeight, cursor: tool === 'select' ? 'default' : 'crosshair' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => finishGesture(false)} onDoubleClick={() => { if (tool === 'polyline') finishGesture(); }}/></div>}</div>
        <aside className="nb-ie-properties"><ImageToolProperties tool={activeTool} style={style} selected={selectedOperation} onChange={changeStyle} disabled={busy || !recipe} ratio={ratio} onRatio={setRatio}
          onResetCrop={() => { if (recipe) commit({ ...recipe, crop: { x: 0, y: 0, width: recipe.sourceWidth, height: recipe.sourceHeight } }); }}
          markerValue={selectedOperation?.type === 'marker' ? selectedOperation.value : history?.present.nextMarker ?? 1}
          onMarkerValue={value => { const current = historyRef.current; if (!current) return; if (selectedOperation?.type === 'marker') commit({ ...current.present.recipe, operations: current.present.recipe.operations.map(operation => operation.id === selected ? { ...selectedOperation, value } : operation) }); else apply(commitImageEdit(current, current.present.recipe, value)); }} />
          {selected && <button className="nb-ie-delete" disabled={busy} onClick={removeSelected}><Trash2 size={14}/>删除所选标注</button>}
          <section className="nb-ie-output"><h3>输出</h3><label>格式<select aria-label="导出格式" disabled={busy} value={mime} onChange={event => setMime(event.target.value as ImageExportMimeType)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
            {mime !== 'image/png' && <label>质量<input aria-label="导出质量" disabled={busy} type="number" min={1} max={100} value={quality} onChange={event => setQuality(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}/><span>%</span></label>}
            <label>尺寸<input aria-label="导出比例" disabled={busy} type="number" min={1} max={200} value={scale} onChange={event => setScale(Math.max(1, Math.min(200, Number(event.target.value) || 1)))}/><span>%</span></label>
            <p>{Math.round(size.width * scale / 100)} × {Math.round(size.height * scale / 100)} px</p><p className="nb-ie-note">保存为 8 位图片，不保留 HDR 和相机元数据。</p></section>
        </aside>
      </div>
      {error && <div role="alert" className="nb-ie-message">{error}</div>}
      {large && <div className="nb-ie-message" role="alert"><span>{large}</span><button onClick={() => void save(true)}>继续导出</button><button onClick={() => setLarge('')}>取消</button></div>}
      <footer className="nb-ie-footer"><div className="nb-ie-actions"><button aria-label="缩小预览" onClick={() => setZoom(value => Math.max(.25, value / 1.25))}><Minus size={16}/></button><span>{Math.round(fit * zoom * 100)}%</span><button aria-label="放大预览" onClick={() => setZoom(value => Math.min(8, value * 1.25))}><Plus size={16}/></button><button aria-label="适合窗口" title="适合窗口" onClick={() => setZoom(1)}><Maximize size={16}/></button></div><span className="nb-ie-hint">{tool === 'polyline' ? '点击添加转折点，双击或 Enter 完成' : tool === 'crop' ? '拖动框选裁剪区域' : tool === 'text' ? '输入文字后，点击图片放置' : '拖动绘制 · 选择工具可移动标注'}</span>
        <button className="nb-ie-save" disabled={loading || !recipe || busy} onClick={() => void save()}><Save size={16}/>{busy ? '正在保存…' : options.saveLabel || '保存图片'}</button></footer>
      {closing && <div className="nb-ie-confirm"><div role="alertdialog" aria-label="保留图片编辑"><h3>保留这次编辑？</h3><p>稍后继续会保留编辑进度，原图保持不变。</p><div><button onClick={() => setClosing(false)}>继续编辑</button><button onClick={() => { discardImageEditorDraft(options.key); close(); }}>放弃改动</button><button onClick={close}>稍后继续</button><button className="nb-ie-save" onClick={() => { setClosing(false); void save(); }}>保存</button></div></div></div>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
