import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, X, FileOutput, AlertCircle } from 'lucide-react';
import { captureDocument } from './capture';
import { DEFAULT_PDF, type ExportDocument, type ItemMode } from './model';
import { usePdfJob } from './usePdfJob';
import { PdfPreview } from './PdfPreview';
import { ExportDiagnostics } from './ExportDiagnostics';
import { ExportProgress } from './ExportProgress';
import { useSettingsStore } from '../../stores/settingsStore';
import { presentExportedFile } from './exportCompletion';
import { DEFAULT_NATIVE_EXTENSION, NATIVE_DOCUMENT_EXTENSIONS } from '../../core/nativeDocument';
import './export.css';

export function ExportModal({ docKey, onClose }: { docKey: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<ExportDocument | null>(null);
  const [captureStartedAt, setCaptureStartedAt] = useState(() => performance.now());
  const [options, setOptions] = useState(DEFAULT_PDF);
  const [format, setFormat] = useState('pdf');
  const [nativeExtension, setNativeExtension] = useState(DEFAULT_NATIVE_EXTENSION);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [pages, setPages] = useState(0);
  const [acceptedReceipt, setAcceptedReceipt] = useState<string>();
  const [item, setItem] = useState('');
  const [navigation, setNavigation] = useState<{ id: string; serial: number }>();
  const session = useRef<{ controller: AbortController; pandoc?: string } | null>(null);
  const savingRef = useRef(false);
  const navigateToItem = (id: string) => { setItem(id); setNavigation(value => ({ id, serial: (value?.serial ?? 0) + 1 })); };
  const [itemSearch, setItemSearch] = useState('');
  const path = useSettingsStore(s => s.settings.export?.pandocPath ?? '');
  const pdf = usePdfJob(document, options, format === 'pdf', captureStartedAt);
  useEffect(() => { setAcceptedReceipt(undefined); }, [document, pdf.receipt?.id]);
  useEffect(() => {
    let disposed = false;
    setDocument(null); setCaptureStartedAt(performance.now());
    const controller = new AbortController();
    const current = { controller } as { controller: AbortController; pandoc?: string }; session.current = current;
    void captureDocument(docKey, controller.signal).then(value => { if (!disposed) setDocument(value); }).catch(error => { if (!disposed) setError(String(error)); });
    return () => {
      disposed = true; controller.abort();
      if (current.pandoc) void invoke('cancel_pandoc', { id: current.pandoc }).catch(() => {});
      if (session.current === current) session.current = null;
    };
  }, [docKey]);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('select')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const itemIndex = useMemo(() => new Map(document?.items.map(value => [value.id, value])), [document]);
  const currentItem = itemIndex.get(item);
  const issueIds = useMemo(() => new Set(pdf.receipt?.issues.filter(issue => issue.blocking).map(issue => issue.id) ?? []), [pdf.receipt]);
  const diagnostics = useMemo(() => [error && error !== '已导出' ? error : '', pdf.error,
    ...(pdf.receipt?.issues.map(issue => `${itemIndex.get(issue.id)?.label ?? issue.id}: ${issue.message}`) ?? [])].filter(Boolean).join('\n\n'), [error, pdf.error, pdf.receipt, itemIndex]);
  const visibleItems = useMemo(() => {
    const result = []; const query = itemSearch.toLowerCase();
    for (const id of pdf.receipt?.adjustable ?? []) {
      const value = itemIndex.get(id);
      if (value && value.label.toLowerCase().includes(query)) result.push(value);
      if (result.length === 100) break;
    }
    return result;
  }, [pdf.receipt, itemIndex, itemSearch]).slice();
  if (currentItem && !visibleItems.includes(currentItem)) visibleItems.unshift(currentItem);
  const blocked = pdf.receipt?.issues.some(issue => issue.blocking);
  const receiptKey = pdf.receipt ? `${pdf.receipt.id}:${pdf.receipt.revision}` : undefined;
  const accepted = acceptedReceipt !== undefined && acceptedReceipt === receiptKey;
  const download = async () => {
    const current = session.current;
    if (!document || !current || savingRef.current) return;
    const { signal } = current.controller;
    savingRef.current = true;
    setSaving(true); setError('');
    try {
      const extension = format === 'noteboard' ? nativeExtension : format === 'html5' ? 'html' : format === 'latex' ? 'tex' : format;
      const destination = await save({ defaultPath: document.title.replace(/\.[^.]+$/, '') + '.' + extension,
        filters: [{ name: format.toUpperCase(), extensions: [extension] }] });
      signal.throwIfAborted();
      if (!destination) return;
      let warnings = '';
      if (format === 'pdf' && pdf.receipt) await invoke('save_pdf', { id: pdf.receipt.id, revision: pdf.receipt.revision, path: destination });
      else if (format === 'md' || format === 'noteboard') {
        const { prepareTextExport } = await import('./documentConversion');
        const content = await prepareTextExport(document.source ?? document.markdown, format, document.baseDirectory, signal);
        signal.throwIfAborted();
        const { writeDocument } = await import('../../core/ipc/commands');
        const result = await writeDocument(destination, content, 'utf8', 'lf');
        if (!result.ok) throw new Error('文档导出失败：' + (result.error?.kind ?? '无法写入文件'));
      }
      else {
        const id = crypto.randomUUID(); current.pandoc = id;
        await invoke('begin_pandoc', { id }); signal.throwIfAborted();
        const { preparePandoc } = await import('./documentConversion');
        const source = await preparePandoc(document.source ?? document.markdown, signal); signal.throwIfAborted();
        warnings = await invoke<string>('pandoc_export', { id, path, format, source, directory: document.baseDirectory, destination });
      }
      onClose();
      await presentExportedFile(destination, warnings || undefined);
    } catch (error) { if (!signal.aborted) setError(String(error)); } finally {
      if (current.pandoc) { void invoke('cancel_pandoc', { id: current.pandoc }).catch(() => {}); current.pandoc = undefined; }
      savingRef.current = false;
      if (!signal.aborted) setSaving(false);
    }
  };
  const number = (key: 'marginMm' | 'fontPt' | 'lineHeight', label: string, min: number, max: number, step: number) => <label className="export-field">{label}
    <input type="number" min={min} max={max} step={step} value={options[key]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setOptions(o => ({ ...o, [key]: Math.min(max, Math.max(min, value)) })); }}/></label>;
  return <div className="export-backdrop"><div ref={dialog} data-shortcuts-suspended role="dialog" aria-modal="true" aria-label="导出文档" className="export-dialog">
    <header><div><FileOutput size={18}/><strong>导出</strong><span className="export-title">{document?.title}</span></div>
      <button className="export-icon" aria-label="关闭导出" onClick={onClose}><X size={18}/></button></header>
    <div className="export-body"><aside>
      <label className="export-field">格式<select value={format} onChange={e => { if (e.target.value === 'pdf') setCaptureStartedAt(performance.now()); setFormat(e.target.value); }}><option value="pdf">PDF</option><option value="md">Markdown (.md)</option><option value="noteboard">NoteBoard 文档</option><option value="docx">Word (.docx)</option><option value="html5">HTML</option><option value="latex">LaTeX</option></select></label>
      {format === 'noteboard' && <label className="export-field">文件后缀<select value={nativeExtension} onChange={e => setNativeExtension(e.target.value)}>{NATIVE_DOCUMENT_EXTENSIONS.map(ext => <option key={ext} value={ext}>.{ext}</option>)}</select></label>}
      {format === 'pdf' ? <>
        <div className="export-two"><label className="export-field">纸张<select value={options.paper} onChange={e => setOptions(o => ({ ...o, paper: e.target.value as 'A4' | 'Letter' }))}><option>A4</option><option>Letter</option></select></label>
          <label className="export-field">方向<select value={String(options.landscape)} onChange={e => setOptions(o => ({ ...o, landscape: e.target.value === 'true' }))}><option value="false">纵向</option><option value="true">横向</option></select></label></div>
        {number('marginMm', '页边距 (mm)', 0, 40, 1)}
        <div className="export-two">{number('fontPt', '正文字号 (pt)', 8, 24, .5)}{number('lineHeight', '行距', 1, 2.5, .1)}</div>
        <label className="export-check"><input type="checkbox" checked={options.pageNumbers} onChange={e => setOptions(o => ({ ...o, pageNumbers: e.target.checked }))}/>页码</label>
        {options.pageNumbers && <div className="export-two">
          <label className="export-field">位置<select value={options.pageNumberPosition} onChange={e => setOptions(o => ({ ...o, pageNumberPosition: e.target.value as typeof o.pageNumberPosition }))}>
            <option value="bottom-center">底部居中</option><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option>
            <option value="top-center">顶部居中</option><option value="top-left">左上角</option><option value="top-right">右上角</option>
          </select></label>
          <label className="export-field">样式<select value={options.pageNumberStyle} onChange={e => setOptions(o => ({ ...o, pageNumberStyle: e.target.value as typeof o.pageNumberStyle }))}>
            <option value="number">1</option><option value="total">1 / 10</option><option value="dashes">- 1 -</option>
          </select></label>
        </div>}
        {!!pdf.receipt?.adjustable.length && <section className="export-item-settings"><h4>超宽内容</h4>
          {pdf.receipt.adjustable.length > 20 && <input aria-label="搜索超宽内容" placeholder="搜索公式或表格" value={itemSearch} onChange={e => setItemSearch(e.target.value)}/>}
          <div className="export-item-list" aria-label="需要调整的公式与表格">{visibleItems.map(value => <button key={value.id} title={value.label} className={(value.id === item ? 'selected ' : '') + (issueIds.has(value.id) ? 'has-error' : '')} onClick={() => navigateToItem(value.id)}>{value.label}</button>)}</div>
          {currentItem && <label className="export-field">排版方式<select value={options.items[item] ?? 'auto'} onChange={e => setOptions(o => ({ ...o, items: { ...o.items, [item]: e.target.value as ItemMode } }))}>
            <option value="auto">视觉最优</option><option value="fit">缩到正文宽度</option>{currentItem.kind === 'table' && <><option value="wrap">单表换行</option><option value="columns">分栏续表（重复首列）</option></>}
          </select></label>}
        </section>}
        {pdf.receipt?.issues.slice(0, 100).map((issue, index) => <button key={index} className="export-issue" onClick={() => navigateToItem(issue.id)}><AlertCircle size={15}/><span>{itemIndex.get(issue.id)?.label && <strong>{itemIndex.get(issue.id)!.label}<br/></strong>}{issue.message}</span></button>)}
        {blocked && <label className="export-check"><input type="checkbox" checked={accepted} onChange={e => setAcceptedReceipt(e.target.checked ? receiptKey : undefined)}/>仍按预览导出（含缺失或裁切内容）</label>}
      </> : <p className="export-note">{format === 'md' ? '保留正文、链接和表格内容，移除专用样式。复杂表格使用标准 HTML 保留单元格内的内容。' : format === 'noteboard' ? '保留完整排版与表格结构，可继续在 NoteBoard 中编辑。' : '由本机 Pandoc 转换。Word 的分页会随打开它的软件变化。'}</p>}
    </aside><main>{format === 'pdf' ? <>
      {pdf.receipt ? <PdfPreview receipt={pdf.receipt} onPages={setPages} onSettled={pdf.previewSettled} selected={item} navigation={navigation} onSelect={id => { setItem(id); setNavigation(undefined); }} issues={issueIds}/>
        : pdf.error || (!document && error) ? <div className="export-empty">暂时无法生成预览</div>
        : <ExportProgress progress={pdf.progress ?? { phase: document ? 'starting' : 'preparing', startedAt: captureStartedAt }}/>}
      {pdf.receipt && pdf.busy && <div className="export-updating"><ExportProgress compact progress={pdf.progress ?? { phase: 'starting', startedAt: captureStartedAt }}/></div>}
    </> : <div className="export-empty"><FileOutput size={36}/><p>{format === 'md' ? 'Markdown 文档' : format === 'noteboard' ? 'NoteBoard 文档' : format === 'docx' ? '可编辑的 Word 文档' : format === 'latex' ? 'LaTeX 源文件' : '独立 HTML 文件'}</p></div>}</main></div>
    <footer><ExportDiagnostics message={error || pdf.error || (blocked ? '有内容超出页面，点击红色标记调整。' : format === 'pdf' && pages ? `${pages} 页` : '')} details={diagnostics}/>
      <button className="export-primary" onClick={() => void download()} disabled={!document || saving || (format === 'pdf' && (pdf.busy || !pdf.receipt || !!pdf.error || (blocked && !accepted)))}><Download size={16}/>{saving ? '导出中…' : '导出'}</button></footer>
  </div></div>;
}
