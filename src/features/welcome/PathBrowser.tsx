import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, FolderOpen, HardDrive, Search } from 'lucide-react';
import { browseLocations, pathExists, readDir, type BrowseLocation } from '../../core/ipc/commands';
import type { FileTreeNode } from '../../core/ipc/types';
import { getFileIcon } from '../../components/FileIcon';
import { normalizeFileInput } from './fileInput';
import './pathBrowser.css';

export function parentBrowsePath(path: string) {
  const value = path.replace(/[\\/]+$/, '');
  if (/^[a-z]:$/i.test(value) || /^\\\\[^\\]+\\[^\\]+$/.test(value)) return null;
  const at = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (at < 0) return null;
  const parent = value.slice(0, at);
  return /^[a-z]:$/i.test(parent) ? parent + '\\' : parent;
}

/** A single chooser owns both files and folders. Directory I/O is asynchronous;
 * only visible entries are mounted, independently of directory size. */
export function PathBrowser({ initialPath, finish, back }: { initialPath: string; finish: (paths: string[]) => void; back: () => void }) {
  const [locations, setLocations] = useState<BrowseLocation[]>([]);
  const [directory, setDirectory] = useState('');
  const [address, setAddress] = useState('');
  const [entries, setEntries] = useState<FileTreeNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(''); const filter = useDeferredValue(query.trim().toLocaleLowerCase());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0), scroll = useRef<HTMLDivElement>(null), anchor = useRef<number | null>(null);
  const visible = useMemo(() => filter ? entries.filter(entry => entry.name.toLocaleLowerCase().includes(filter)) : entries, [entries, filter]);
  const virtual = useVirtualizer({ count: visible.length, getScrollElement: () => scroll.current, estimateSize: () => 36, overscan: 6 });

  const navigate = async (path: string) => {
    const generation = ++request.current; setBusy(true); setError('');
    try {
      const children = await readDir(path, false);
      if (generation !== request.current) return;
      setDirectory(path); setAddress(path); setEntries(children); setSelected(new Set()); setQuery(''); anchor.current = null;
      scroll.current?.scrollTo({ top: 0 });
    } catch (reason) { if (generation === request.current) setError(String(reason)); }
    finally { if (generation === request.current) setBusy(false); }
  };
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const roots = await browseLocations(); if (disposed) return; setLocations(roots);
        let path = roots[0]?.path ?? '';
        if (initialPath.trim()) {
          try { const candidate = normalizeFileInput(initialPath), info = await pathExists(candidate); if (info.exists) path = info.isDir ? candidate : parentBrowsePath(candidate) ?? path; } catch { /* Start in the home folder if the typed path is incomplete. */ }
        }
        if (!disposed && path) await navigate(path);
      } catch (reason) { if (!disposed) setError(String(reason)); }
    })();
    return () => { disposed = true; request.current++; };
  }, []);
  const go = async () => {
    try {
      const path = normalizeFileInput(address), info = await pathExists(path);
      if (!info.exists) throw new Error('找不到此文件或文件夹');
      if (info.isDir) await navigate(path); else finish([path]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const select = (index: number, ctrl: boolean, shift: boolean) => {
    setSelected(previous => {
      const next = ctrl ? new Set(previous) : new Set<string>();
      if (shift && anchor.current !== null) for (let at = Math.min(anchor.current, index); at <= Math.max(anchor.current, index); at++) next.add(visible[at].path);
      else if (ctrl && next.has(visible[index].path)) next.delete(visible[index].path);
      else next.add(visible[index].path);
      return next;
    });
    if (!shift) anchor.current = index;
  };
  const parent = parentBrowsePath(directory);
  return <div className="nb-path-browser">
    <form className="nb-browser-address" onSubmit={event => { event.preventDefault(); void go(); }}>
      <button type="button" aria-label="上一级文件夹" title="上一级文件夹" disabled={!parent || busy} onClick={() => parent && void navigate(parent)}><ArrowUp size={17}/></button>
      <input aria-label="浏览位置" value={address} onChange={event => setAddress(event.target.value)} spellCheck={false}/>
      <button type="submit" disabled={busy}>前往</button>
    </form>
    <div className="nb-browser-body">
      <nav aria-label="常用位置">{locations.map(location => <button key={location.path} type="button" onClick={() => void navigate(location.path)} title={location.path}>
        {location.kind === 'drive' ? <HardDrive size={16}/> : <FolderOpen size={16}/>}<span>{location.name}</span>
      </button>)}</nav>
      <section>
        <label className="nb-browser-filter"><Search size={15}/><input aria-label="筛选当前文件夹" placeholder="筛选当前文件夹" value={query} onChange={event => { setQuery(event.target.value); anchor.current = null; }}/></label>
        <div ref={scroll} className="nb-browser-entries" role="listbox" aria-label="文件和文件夹" aria-multiselectable="true" aria-busy={busy}>
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>{virtual.getVirtualItems().map(row => {
            const entry = visible[row.index];
            return <button key={entry.path} type="button" role="option" aria-selected={selected.has(entry.path)} title={entry.name}
              className="nb-browser-entry" disabled={busy} style={{ position: 'absolute', top: row.start, height: row.size }}
              onClick={event => select(row.index, event.ctrlKey || event.metaKey, event.shiftKey)}
              onDoubleClick={() => entry.isDir ? void navigate(entry.path) : finish([entry.path])}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); finish([entry.path]); }
                if (event.key === 'ArrowRight' && entry.isDir) { event.preventDefault(); void navigate(entry.path); }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault(); const next = Math.max(0, Math.min(visible.length - 1, row.index + (event.key === 'ArrowDown' ? 1 : -1)));
                  select(next, false, event.shiftKey); virtual.scrollToIndex(next);
                  requestAnimationFrame(() => scroll.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus());
                }
              }} data-index={row.index}>
              {getFileIcon(entry.name, { isDir: entry.isDir, size: 18 })}<span>{entry.name}</span><small>{entry.isDir ? '文件夹' : '文件'}</small>
            </button>;
          })}</div>
          {!busy && !visible.length && <p className="nb-browser-empty">{filter ? '没有匹配的文件或文件夹' : '此文件夹为空'}</p>}
        </div>
      </section>
    </div>
    {error && <p role="alert" className="nb-browser-error">{error}</p>}
    <footer><span role="status">{busy ? '正在读取…' : selected.size ? `已选择 ${selected.size} 项` : '未选择条目时打开当前文件夹'}</span>
      <button type="button" className="nb-btn-secondary" onClick={back}>返回</button>
      <button type="button" className="nb-btn-primary" disabled={busy || !directory} onClick={() => finish(selected.size ? [...selected] : [directory])}>打开</button>
    </footer>
  </div>;
}
