import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, X, FileOutput, LoaderCircle, AlertCircle } from 'lucide-react';
import { captureDocument } from './capture';
import { DEFAULT_PDF, type ExportDocument, type ItemMode } from './model';
import { usePdfJob } from './usePdfJob';
import { PdfPreview } from './PdfPreview';
import { useSettingsStore } from '../../stores/settingsStore';
import './export.css';

export function ExportModal({ docKey, onClose }: { docKey: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<ExportDocument | null>(null);
  const [options, setOptions] = useState(DEFAULT_PDF);
  const [format, setFormat] = useState('pdf');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [pages, setPages] = useState(0);
  const [item, setItem] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const path = useSettingsStore(s => s.settings.export?.pandocPath ?? '');
  const pdf = usePdfJob(document, options, format === 'pdf');
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    void captureDocument(docKey, controller.signal).then(value => { if (!disposed) setDocument(value); }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; controller.abort(); };
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
  const currentItem = document?.items.find(value => value.id === item);
  const visibleItems = document?.items.filter(value => value.label.toLowerCase().includes(itemSearch.toLowerCase())).slice(0, 100) ?? [];
  if (currentItem && !visibleItems.includes(currentItem)) visibleItems.unshift(currentItem);
  const blocked = pdf.receipt?.issues.some(issue => issue.blocking);
  const download = async () => {
    if (!document) return;
    setSaving(true); setError('');
    try {
      if (format !== 'pdf') {
        const status = await invoke<{ available: boolean }>('pandoc_status', { path });
        if (!status.available) { setError('未找到 Pandoc，请在「设置 → 导出」中选择程序或下载安装。'); return; }
      }
      const extension = format === 'html5' ? 'html' : format === 'latex' ? 'tex' : format;
      const destination = await save({ defaultPath: document.title.replace(/\.[^.]+$/, '') + '.' + extension,
        filters: [{ name: format.toUpperCase(), extensions: [extension] }] });
      if (!destination) return;
      if (format === 'pdf' && pdf.receipt) await invoke('save_pdf', { id: pdf.receipt.id, path: destination });
      else {
        const { pandocSource } = await import('./pandocDocument');
        const warnings = await invoke<string>('pandoc_export', { path, format, source: pandocSource(document.markdown), directory: document.baseDirectory, destination });
        if (warnings) { setError('已导出，请检查：' + warnings); return; }
      }
      setError('已导出');
    } catch (error) { setError(String(error)); } finally { setSaving(false); }
  };
  const number = (key: 'marginMm' | 'fontPt' | 'lineHeight' | 'minimumPt', label: string, min: number, max: number, step: number) => <label className="export-field">{label}
    <input type="number" min={min} max={max} step={step} value={options[key]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setOptions(o => ({ ...o, [key]: Math.min(max, Math.max(min, value)) })); }}/></label>;
  return <div className="export-backdrop"><div ref={dialog} data-shortcuts-suspended role="dialog" aria-modal="true" aria-label="导出文档" className="export-dialog">
    <header><div><FileOutput size={18}/><strong>导出</strong><span className="export-title">{document?.title}</span></div>
      <button className="export-icon" aria-label="关闭导出" onClick={onClose}><X size={18}/></button></header>
    <div className="export-body"><aside>
      <label className="export-field">格式<select value={format} onChange={e => setFormat(e.target.value)}><option value="pdf">PDF</option><option value="docx">Word (.docx)</option><option value="html5">HTML</option><option value="latex">LaTeX</option></select></label>
      {format === 'pdf' ? <>
        <div className="export-two"><label className="export-field">纸张<select value={options.paper} onChange={e => setOptions(o => ({ ...o, paper: e.target.value as 'A4' | 'Letter' }))}><option>A4</option><option>Letter</option></select></label>
          <label className="export-field">方向<select value={String(options.landscape)} onChange={e => setOptions(o => ({ ...o, landscape: e.target.value === 'true' }))}><option value="false">纵向</option><option value="true">横向</option></select></label></div>
        {number('marginMm', '页边距 (mm)', 0, 40, 1)}
        <div className="export-two">{number('fontPt', '正文字号 (pt)', 8, 24, .5)}{number('lineHeight', '行距', 1, 2.5, .1)}</div>
        {number('minimumPt', '缩小后最小字号 (pt)', 6, 14, .5)}
        <label className="export-check"><input type="checkbox" checked={options.pageNumbers} onChange={e => setOptions(o => ({ ...o, pageNumbers: e.target.checked }))}/>页眉与页码</label>
        {!!document?.items.length && <section className="export-item-settings"><h4>公式与表格</h4>
          {document.items.length > 20 && <input aria-label="搜索公式或表格" placeholder="搜索公式或表格" value={itemSearch} onChange={e => setItemSearch(e.target.value)}/>}
          <select aria-label="选择公式或表格" value={item} onChange={e => setItem(e.target.value)}><option value="">选择要调整的内容</option>{visibleItems.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select>
          {currentItem && <label className="export-field">排版方式<select value={options.items[item] ?? 'auto'} onChange={e => setOptions(o => ({ ...o, items: { ...o.items, [item]: e.target.value as ItemMode } }))}>
            <option value="auto">自动</option><option value="fit">优先缩小</option><option value="wrap">优先换行</option>{currentItem.kind === 'table' && <option value="columns">分栏续表（重复首列）</option>}
          </select></label>}
        </section>}
        {pdf.receipt?.issues.map((issue, index) => <button key={index} className="export-issue" onClick={() => setItem(issue.id)}><AlertCircle size={15}/><span>{issue.message}</span></button>)}
      </> : <p className="export-note">由本机 Pandoc 转换。Word 的分页会随打开它的软件变化。</p>}
    </aside><main>{format === 'pdf' ? <>
      {pdf.bytes ? <PdfPreview bytes={pdf.bytes} onPages={setPages}/> : <div className="export-empty">{pdf.error || error ? '暂时无法生成预览' : '正在排版…'}</div>}
      {pdf.busy && <div className="export-updating"><LoaderCircle size={14}/>更新预览…</div>}
    </> : <div className="export-empty"><FileOutput size={36}/><p>{format === 'docx' ? '可编辑的 Word 文档' : format === 'latex' ? 'LaTeX 源文件' : '独立 HTML 文件'}</p><span>转换后用对应软件查看</span></div>}</main></div>
    <footer><span role="status">{error || pdf.error || (format === 'pdf' && pages ? `${pages} 页` : '')}</span>
      <button className="export-primary" onClick={() => void download()} disabled={!document || saving || (format === 'pdf' && (pdf.busy || !pdf.receipt || !!pdf.error || blocked))}><Download size={16}/>{saving ? '导出中…' : '导出'}</button></footer>
  </div></div>;
}
