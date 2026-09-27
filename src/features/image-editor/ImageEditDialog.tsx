import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Circle, Crop, Eraser, FlipHorizontal2, FlipVertical2, Focus, Hash, Highlighter, LayoutGrid, Maximize, Minus, MousePointer2, Pencil, Plus, Redo2, RotateCw, Save, Square, Trash2, Type, Undo2, Waypoints, X, ZoomIn } from 'lucide-react';
import { commitImageEdit, createImageEditRecipe, redoImageEdit, undoImageEdit, type ImageEditHistory, type ImageEditRecipe, type ImageEditorTool } from './model';
import { getMagnifierRect, getOutputSize } from './geometry';
import { exportImageEdit, getImageExportSize, LargeImageExportConfirmationError, type ImageExportMimeType } from './exporter';
import { loadImageResource, type ImageResource } from './resources';
import { acquireImageEditorDraft, discardImageEditorDraft, hasImageEditorDraft, updateImageEditorDraft } from './sessions';
import { DEFAULT_TOOL_STYLE, type ToolStyle } from './toolDefaults';
import { ImageToolProperties } from './ImageToolProperties';
import type { ImageEditorController, ImageEditorOptions } from './types';
import { ImageCanvasInteraction, type CanvasInteractionAdapter } from './canvasInteraction';
import { ImageCanvasStage } from './ImageCanvasStage';
import { applyImageTransform, type ImageTransformAction } from '../image/sharedTransform';
import './imageEditor.css';

const TOOLS = [
  ['select', '选择', MousePointer2], ['crop', '裁剪', Crop], ['pen', '铅笔', Pencil], ['highlighter', '荧光笔', Highlighter],
  ['line', '箭头', ArrowUpRight], ['polyline', '折线', Waypoints], ['rectangle', '矩形', Square], ['ellipse', '椭圆', Circle],
  ['text', '文字', Type], ['marker', '序号', Hash], ['mosaic', '马赛克', LayoutGrid], ['spotlight', '聚光灯', Focus],
  ['magnifier', '放大镜', ZoomIn], ['eraser', '笔迹擦除', Eraser], ['object-eraser', '对象擦除', Trash2],
] as const;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable=true]'));

export function ImageEditDialog({ options, register, close }: { options: ImageEditorOptions; register(controller: ImageEditorController): void; close(): void }) {
  const [history, setHistory] = useState<ImageEditHistory | null>(null);
  const historyRef = useRef<ImageEditHistory | null>(null), resource = useRef<ImageResource | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [tool, setTool] = useState<ImageEditorTool>('select');
  const [style, setStyle] = useState<ToolStyle>(DEFAULT_TOOL_STYLE);
  const strokeWidths = useRef<Partial<Record<ImageEditorTool, number>>>({ highlighter: 24, eraser: 20, 'object-eraser': 40, 'mosaic-brush': 40 });
  const [mosaicMode, setMosaicMode] = useState<'brush' | 'rectangle'>('rectangle');
  const [magnifierShape, setMagnifierShape] = useState<'circle' | 'ellipse'>('ellipse');
  const [ratio, setRatio] = useState(0), [zoom, setZoom] = useState(1), [displayScale, setDisplayScale] = useState(1);
  const [mime, setMime] = useState<ImageExportMimeType>('image/png'), [quality, setQuality] = useState(92), [scale, setScale] = useState(100);
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [large, setLarge] = useState('');
  const [writing, setWriting] = useState(false);
  const alive = useRef(true), exportAbort = useRef<AbortController | null>(null), saving = useRef(false);
  const [, refreshControls] = useState(0);
  const empty = useRef(createImageEditRecipe(1, 1));
  const apply = (value: ImageEditHistory) => { historyRef.current = value; updateImageEditorDraft(options.key, value); setHistory(value); };
  const commit = (value: ImageEditRecipe, nextMarker?: number) => { if (historyRef.current) apply(commitImageEdit(historyRef.current, value, nextMarker)); };
  const adapter = useRef<CanvasInteractionAdapter>(null!);
  adapter.current = {
    recipe: () => historyRef.current?.present.recipe ?? empty.current,
    tool: () => tool === 'mosaic' && mosaicMode === 'brush' ? 'mosaic-brush' : tool,
    style: () => style, nextMarker: () => historyRef.current?.present.nextMarker ?? 1,
    ratio: () => ratio, circleMagnifier: () => magnifierShape === 'circle', commit,
    controlsChanged: () => refreshControls(value => value + 1),
  };
  const interaction = useRef<ImageCanvasInteraction>(null!);
  if (!interaction.current) interaction.current = new ImageCanvasInteraction({
    recipe: () => adapter.current.recipe(), tool: () => adapter.current.tool(), style: () => adapter.current.style(),
    nextMarker: () => adapter.current.nextMarker(), ratio: () => adapter.current.ratio(), circleMagnifier: () => adapter.current.circleMagnifier(),
    commit: (value, marker) => adapter.current.commit(value, marker), controlsChanged: () => adapter.current.controlsChanged(),
  });
  const canvas = interaction.current;
  useEffect(() => {
    const abort = new AbortController(); alive.current = true;
    register({ suspend() { canvas.finish(); exportAbort.current?.abort(); abort.abort(); } });
    void loadImageResource(options.src, abort.signal).then(image => {
      if (abort.signal.aborted) { image.dispose(); return; }
      try { const initial = acquireImageEditorDraft(options.key, image.width, image.height); resource.current = image; historyRef.current = initial; setHistory(initial); canvas.refresh(); }
      catch (failure) { image.dispose(); setError(String(failure)); }
      setLoading(false);
    }).catch(failure => { if (!abort.signal.aborted) { setError(String(failure)); setLoading(false); } });
    return () => { alive.current = false; abort.abort(); exportAbort.current?.abort(); canvas.dispose(); resource.current?.dispose(); resource.current = null; };
  }, [options.key, options.src, register, canvas]);
  useEffect(() => { canvas.setRatio(); }, [ratio, canvas]);
  const recipe = history?.present.recipe;
  const size = recipe ? getOutputSize(recipe) : { width: 0, height: 0 };
  const selectedOperation = recipe ? canvas.selectedOperation() : undefined;
  const activeTool = canvas.crop ? 'crop' : selectedOperation?.type ?? adapter.current.tool();
  const interactionHint = selectedOperation?.type === 'line' ? '拖动首尾调整方向与长度 · 中点移动 · 滚轮缩放'
    : selectedOperation?.type === 'polyline' ? '拖动节点调整 · 拖动线段移动 · 滚轮缩放'
    : tool === 'object-eraser' ? '圆圈内触及的标注整项删除 · 一次拖动可撤销'
    : tool === 'eraser' ? '圆圈显示实际擦除范围 · 拖动擦除 · Ctrl+Z 撤销'
    : tool === 'polyline' ? '点击添加转折点 · 右键、Esc 或画外点击完成'
    : canvas.crop ? '拖动边框调整 · Enter 应用 · Esc 取消'
    : tool === 'text' ? '点击图片输入文字 · 再次点击文字可编辑'
    : '拖动标注移动 · 边框或滚轮缩放 · Alt 按住可重叠绘制';

  function choose(value: ImageEditorTool) {
    canvas.finish(); canvas.clearSelection(); setTool(value); setError('');
    setStyle(previous => ({ ...previous, width: strokeWidths.current[value === 'mosaic' && mosaicMode === 'brush' ? 'mosaic-brush' : value] ?? 4 }));
    if (value === 'crop') canvas.beginCrop();
  }
  function changeStyle(patch: Partial<ToolStyle>) {
    if (patch.width !== undefined) strokeWidths.current[activeTool] = patch.width;
    setStyle(value => ({ ...value, ...patch })); canvas.changeStyle(patch);
  }
  function removeSelected() { canvas.removeSelected(); }
  function undo() { canvas.prepareHistory(); if (historyRef.current) apply(undoImageEdit(historyRef.current)); if (tool === 'crop') setTool('select'); }
  function redo() { canvas.prepareHistory(); if (historyRef.current) apply(redoImageEdit(historyRef.current)); if (tool === 'crop') setTool('select'); }
  function endCrop(keep: boolean) { if (keep) canvas.applyCrop(); else canvas.cancelCrop(); setTool('select'); }
  function finishGesture() { canvas.finish(); if (tool === 'crop') setTool('select'); }
  function transformImage(action: ImageTransformAction) {
    finishGesture();
    if (historyRef.current) commit(applyImageTransform(historyRef.current.present.recipe, action));
  }
  function requestClose() { if (saving.current) return; canvas.finish(); if (busy) { exportAbort.current?.abort(); setBusy(false); return; } if (hasImageEditorDraft(options.key)) setClosing(true); else { discardImageEditorDraft(options.key); close(); } }
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
    else if (event.key === 'Enter' && !busy) { if (canvas.crop) { event.preventDefault(); endCrop(true); } else if (canvas.finishPolyline()) event.preventDefault(); }
    else if (!busy && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeSelected(); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="nb-ie-backdrop" /><Dialog.Content className="nb-ie-dialog" data-shortcuts-suspended onKeyDown={shortcuts} onCloseAutoFocus={event => event.preventDefault()}
      onPointerDownCapture={event => { if (!(event.target instanceof Element) || event.target.closest('.nb-ie-canvas-wrap')) return; canvas.finishPolyline(); if (!event.target.closest('.nb-ie-properties')) canvas.outside(); }}
      onPointerDownOutside={event => { event.preventDefault(); canvas.outside(); }}
      onEscapeKeyDown={event => { event.preventDefault(); if (busy) return; const cropping = !!canvas.crop; if (canvas.escape()) { if (cropping) setTool('select'); } else if (closing) setClosing(false); else requestClose(); }}>
      <header className="nb-ie-header"><div><Dialog.Title>编辑图片</Dialog.Title><Dialog.Description>{options.name || '图片'}</Dialog.Description></div>
        <div className="nb-ie-actions"><button title="撤销 Ctrl+Z" aria-label="撤销图片编辑" disabled={!history?.past.length || busy} onClick={undo}><Undo2 size={18}/></button><button title="重做 Ctrl+Shift+Z" aria-label="重做图片编辑" disabled={!history?.future.length || busy} onClick={redo}><Redo2 size={18}/></button><span className="nb-ie-divider"/><button title="顺时针旋转" aria-label="顺时针旋转" disabled={!recipe || busy} onClick={() => transformImage('rotate-cw')}><RotateCw size={18}/></button><button title="水平镜像" aria-label="水平镜像" disabled={!recipe || busy} onClick={() => transformImage('flip-horizontal')}><FlipHorizontal2 size={18}/></button><button title="垂直镜像" aria-label="垂直镜像" disabled={!recipe || busy} onClick={() => transformImage('flip-vertical')}><FlipVertical2 size={18}/></button><span className="nb-ie-divider"/><button aria-label="关闭图片编辑" disabled={writing} title={busy && !writing ? '取消导出' : '关闭'} onClick={requestClose}><X size={20}/></button></div>
      </header>
      <div className="nb-ie-body"><nav className="nb-ie-tools" aria-label="图片编辑工具">{TOOLS.map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} aria-pressed={tool === value} disabled={!recipe || busy} onClick={() => choose(value)}><Icon size={19}/><span>{label}</span></button>)}</nav>
        {loading || !recipe || !resource.current ? <div className="nb-ie-stage"><div className="nb-ie-loading">{loading ? '正在打开图片…' : '图片无法打开'}</div></div> : <ImageCanvasStage controller={canvas} resource={resource.current} zoom={zoom} onZoom={factor => setZoom(value => Math.max(.25, Math.min(8, value * factor)))} disabled={busy} onScale={setDisplayScale}/>}
        <aside className="nb-ie-properties"><ImageToolProperties tool={activeTool} style={style} selected={selectedOperation} onChange={changeStyle} disabled={busy || !recipe} ratio={ratio} onRatio={setRatio}
          onBeginChange={() => canvas.beginPropertyChange()} onEndChange={() => canvas.endPropertyChange()}
          onResetCrop={() => canvas.resetCrop()} onApplyCrop={() => endCrop(true)} onCancelCrop={() => endCrop(false)} cropSize={canvas.getCropBounds() ?? undefined}
          mosaicMode={mosaicMode} onMosaicMode={mode => { canvas.finish(); canvas.clearSelection(); setMosaicMode(mode); setTool('mosaic'); setStyle(value => ({ ...value, width: strokeWidths.current[mode === 'brush' ? 'mosaic-brush' : 'mosaic'] ?? 40 })); }}
          magnifierShape={magnifierShape} onMagnifierShape={shape => { setMagnifierShape(shape); canvas.changeSelected(op => {
            if (op.type !== 'magnifier') return op;
            const old = getMagnifierRect(op), width = old.width, height = shape === 'circle' ? width : Math.abs(old.height - width) < 1 ? width * .7 : old.height;
            return { ...op, rect: { x: op.center.x - width / 2, y: op.center.y - height / 2, width, height }, radius: Math.max(width, height) / 2 };
          }); }}
          markerValue={selectedOperation?.type === 'marker' ? selectedOperation.value : history?.present.nextMarker ?? 1}
          onMarkerValue={value => { if (selectedOperation?.type === 'marker') canvas.changeSelected(op => op.type === 'marker' ? { ...op, value } : op); else if (historyRef.current) commit(historyRef.current.present.recipe, value); }}
          nextMarkerValue={history?.present.nextMarker ?? 1} onNextMarkerValue={value => { if (historyRef.current) commit(historyRef.current.present.recipe, value); }}/>
          {selectedOperation && <button className="nb-ie-delete" disabled={busy} onClick={removeSelected}><Trash2 size={14}/>删除所选标注</button>}
          <section className="nb-ie-output"><h3>输出</h3><label>格式<select aria-label="导出格式" disabled={busy} value={mime} onChange={event => setMime(event.target.value as ImageExportMimeType)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
            {mime !== 'image/png' && <label>质量<input aria-label="导出质量" disabled={busy} type="number" min={1} max={100} value={quality} onChange={event => setQuality(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}/><span>%</span></label>}
            <label>尺寸<input aria-label="导出比例" disabled={busy} type="number" min={1} max={100} value={scale} onChange={event => setScale(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}/><span>%</span></label>
            <p>{Math.round(size.width * scale / 100)} × {Math.round(size.height * scale / 100)} px</p><p className="nb-ie-note">保存为 8 位图片，不保留 HDR 和相机元数据。</p></section>
        </aside>
      </div>
      {error && <div role="alert" className="nb-ie-message">{error}</div>}
      {large && <div className="nb-ie-message" role="alert"><span>{large}</span><button onClick={() => void save(true)}>继续导出</button><button onClick={() => setLarge('')}>取消</button></div>}
      <footer className="nb-ie-footer"><div className="nb-ie-actions"><button aria-label="缩小预览" onClick={() => setZoom(value => Math.max(.25, value / 1.25))}><Minus size={16}/></button><span>{Math.round(displayScale * 100)}%</span><button aria-label="放大预览" onClick={() => setZoom(value => Math.min(8, value * 1.25))}><Plus size={16}/></button><button aria-label="适合窗口" title="适合窗口" onClick={() => setZoom(1)}><Maximize size={16}/></button></div><span className="nb-ie-hint">{interactionHint}</span>
        <button className="nb-ie-save" disabled={loading || !recipe || busy} onClick={() => void save()}><Save size={16}/>{busy ? '正在保存…' : options.saveLabel || '保存图片'}</button></footer>
      {closing && <div className="nb-ie-confirm"><div role="alertdialog" aria-label="保留图片编辑"><h3>保留这次编辑？</h3><p>稍后继续会保留编辑进度，原图保持不变。</p><div><button onClick={() => setClosing(false)}>继续编辑</button><button className="nb-ie-discard" onClick={() => { discardImageEditorDraft(options.key); close(); }}>放弃改动</button><button onClick={close}>稍后继续</button><button className="nb-ie-save" onClick={() => { setClosing(false); void save(); }}>保存</button></div></div></div>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
