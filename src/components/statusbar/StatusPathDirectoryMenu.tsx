import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronRight } from 'lucide-react';
import { readDir } from '../../core/ipc/commands';
import type { FileTreeNode } from '../../core/ipc/types';
import { openDocument } from '../../features/editor-code/orchestration/openDocument';
import { isSubPath, sameKey } from '../../features/explorer/pathUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { FileIcon } from '../FileIcon';

export default function StatusPathDirectoryMenu({ path, label, currentPath, explorerRoot, closeRoot }: {
  path: string;
  label: string;
  currentPath: string;
  explorerRoot?: string;
  closeRoot: DirectoryMenuProps['closeRoot'];
}) {
  const hidden = useSettingsStore(state => state.settings.file.showHiddenFiles);
  return <DirectoryMenu key={String(hidden)} path={path} label={label} hidden={hidden} currentPath={currentPath} closeRoot={closeRoot} takeFocus
    onFile={entry => {
      closeRoot(true);
      if (!sameKey(entry.path, currentPath)) void openDocument(entry.path, { explorer: 'preserve', explorerRoot });
    }} />;
}

interface DirectoryMenuProps {
  path: string;
  label: string;
  hidden: boolean;
  currentPath: string;
  onFile: (entry: FileTreeNode) => void;
  closeRoot: (restoreFocus?: boolean) => void;
  closeSubmenu?: (restoreFocus: boolean) => void;
  takeFocus: boolean;
  id?: string;
}

const rowHeight = 24;
const separatorHeight = 9;
const hoverDelay = 160;
const entryLimit = 300;

interface SubmenuPointerRoute {
  fromX: number;
  fromY: number;
  toX: number;
  top: number;
  bottom: number;
  expires: number;
}

function submenuGrace(route: SubmenuPointerRoute | undefined, x: number, y: number): number {
  if (!route || route.toX === route.fromX) return 0;
  const position = (x - route.fromX) / (route.toX - route.fromX);
  if (position <= 0 || position >= 1) return 0;
  const lower = route.fromY + (route.top - route.fromY) * position;
  const upper = route.fromY + (route.bottom - route.fromY) * position;
  return y >= lower - 5 && y <= upper + 5 ? route.expires - Date.now() : 0;
}

function DirectoryMenu({ path, label, hidden, currentPath, onFile, closeRoot, closeSubmenu, takeFocus, id }: DirectoryMenuProps) {
  const [result, setResult] = useState<{ entries: FileTreeNode[]; overflow: number } | null>();
  const [focused, setFocused] = useState<number>();
  const [submenu, setSubmenu] = useState<{ index: number; takeFocus: boolean }>();
  const content = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerRoute = useRef<SubmenuPointerRoute>(undefined);
  const prefix = useRef({ text: '', at: 0 });
  const menuId = useId();
  const childId = `${menuId}-children`;
  const entries = result?.entries;
  const current = useMemo(() => entries?.findIndex(entry => entry.isDir ? isSubPath(entry.path, currentPath) : sameKey(entry.path, currentPath)) ?? -1, [entries, currentPath]);
  const firstFile = useMemo(() => entries?.findIndex(entry => !entry.isDir) ?? -1, [entries]);
  const overflow = result?.overflow ?? 0;
  const active = focused ?? Math.max(0, current);
  const submenuIndex = submenu?.index ?? -1;
  const toRow = (index: number) => firstFile > 0 && index >= firstFile ? index + 1 : index;

  useEffect(() => {
    let listening = true;
    void readDir(path, hidden).then(
      entries => {
        if (listening) setResult({ entries: entries.slice(0, entryLimit), overflow: Math.max(0, entries.length - entryLimit) });
      },
      () => { if (listening) setResult(null); },
    );
    return () => { listening = false; clearTimeout(hover.current); };
  }, [path, hidden]);

  const virtual = useVirtualizer({
    count: (entries?.length ?? 0) + Number(firstFile > 0),
    getScrollElement: () => scroll.current,
    estimateSize: index => index === firstFile && firstFile > 0 ? separatorHeight : rowHeight,
    overscan: 4,
    initialRect: { height: rowHeight * 10, width: 240 },
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), toRow(active), toRow(submenuIndex)])]
      .filter(index => index >= 0 && index < range.count).sort((a, b) => a - b),
  });
  const rows = virtual.getVirtualItems();
  const currentRow = toRow(current);

  useLayoutEffect(() => {
    if (currentRow >= 0 && focused === undefined) virtual.scrollToIndex(currentRow, { align: 'auto' });
  }, [currentRow, focused, virtual]);

  useLayoutEffect(() => {
    const element = content.current;
    if (!element || !entries?.length) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    context.font = getComputedStyle(element).font;
    let width = 160;
    for (const entry of entries) width = Math.max(width, context.measureText(entry.name).width + (entry.isDir ? 84 : 68));
    element.style.setProperty('--nb-status-directory-width', `${Math.min(420, Math.ceil(width))}px`);
  }, [entries]);

  const focus = (index: number) => {
    clearTimeout(hover.current);
    setFocused(index);
    if (submenuIndex !== index) setSubmenu(undefined);
    virtual.scrollToIndex(toRow(index), { align: 'auto' });
  };
  const activate = (index: number, openFolderOnly = false) => {
    const entry = entries?.[index];
    if (!entry) return;
    clearTimeout(hover.current);
    if (entry.isDir) {
      setFocused(index);
      if (submenuIndex === index) document.getElementById(childId)?.focus({ preventScroll: true });
      else setSubmenu({ index, takeFocus: true });
    }
    else if (!openFolderOnly) onFile(entry);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') { event.stopPropagation(); closeRoot(true); return; }
    if (event.key === 'ArrowLeft' && closeSubmenu) {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
      return;
    }
    if (!entries?.length || event.nativeEvent.isComposing) return;
    const count = entries.length;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      const next = key === 'Home' ? 0 : key === 'End' ? count - 1 : (active + (key === 'ArrowDown' ? 1 : count - 1)) % count;
      focus(next);
    } else if (key === 'Enter' || key === ' ' || key === 'ArrowRight') {
      activate(active, key === 'ArrowRight');
    } else if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const character = key.toLocaleLowerCase(), now = Date.now();
      const text = now - prefix.current.at > 700 || prefix.current.text === character ? character : prefix.current.text + character;
      prefix.current = { text, at: now };
      const first = text.length === 1 ? active + 1 : active;
      for (let offset = 0; offset < count; offset++) {
        const index = (first + offset) % count;
        if (entries[index].name.toLocaleLowerCase().startsWith(text)) { focus(index); break; }
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return <Popover.Content ref={content} role="menu" tabIndex={-1} id={id}
    className="nb-status-menu nb-status-directory-menu" side={closeSubmenu ? 'right' : 'top'}
    align="start" alignOffset={closeSubmenu ? 0 : -46} sideOffset={4} collisionPadding={8}
    aria-label={label} aria-busy={result === undefined}
    aria-activedescendant={rows.some(row => row.index === toRow(active)) ? `${menuId}-${active}` : undefined}
    data-shortcuts-suspended
    onOpenAutoFocus={event => { event.preventDefault(); if (takeFocus) content.current?.focus({ preventScroll: true }); }}
    onCloseAutoFocus={event => event.preventDefault()}
    onEscapeKeyDown={event => {
      event.preventDefault();
      if (closeSubmenu) closeSubmenu(true);
      else closeRoot(true);
    }}
    onKeyDown={navigate}>
    {!entries?.length && <div className="nb-status-directory-message" role={result === null ? 'alert' : 'status'}>
      {result === undefined ? '正在读取…' : result === null ? '无法读取文件夹' : '此文件夹为空'}
    </div>}
    <div ref={scroll} className="nb-status-directory-entries">
      <div role="presentation" style={{ position: 'relative', height: virtual.getTotalSize() }}>
        {entries && rows.map(row => {
          if (firstFile > 0 && row.index === firstFile) return <div className="nb-status-directory-separator"
            key="separator" style={{ top: row.start, height: row.size }} role="separator" />;
          const index = firstFile > 0 && row.index > firstFile ? row.index - 1 : row.index;
          const entry = entries[index];
          const selected = index === current;
          const expanded = submenuIndex === index;
          const item = <div className="nb-status-menu-item nb-status-directory-entry"
            id={`${menuId}-${index}`} role={entry.isDir ? 'menuitem' : 'menuitemradio'}
            aria-current={entry.isDir && selected ? 'location' : undefined}
            aria-checked={entry.isDir ? undefined : selected}
            aria-haspopup={entry.isDir ? 'menu' : undefined}
            aria-expanded={entry.isDir ? expanded : undefined}
            aria-controls={expanded ? childId : undefined}
            data-active={index === focused || undefined}
            data-state={expanded ? 'open' : undefined}
            title={entry.name}
            style={{ top: row.start, height: row.size }}
            onMouseDown={event => event.preventDefault()}
            onPointerEnter={event => {
              if (event.pointerType !== 'mouse') return;
              clearTimeout(hover.current);
              if (expanded) { setFocused(index); return; }
              const grace = submenuGrace(pointerRoute.current, event.clientX, event.clientY);
              if (grace <= 0) setFocused(index);
              hover.current = setTimeout(() => {
                pointerRoute.current = undefined;
                setFocused(index);
                setSubmenu(entry.isDir ? { index, takeFocus: false } : undefined);
              }, Math.max(hoverDelay, grace));
            }}
            onPointerLeave={event => {
              clearTimeout(hover.current);
              if (!expanded || event.pointerType !== 'mouse') return;
              const child = document.getElementById(childId);
              if (!child) return;
              const bounds = child.getBoundingClientRect();
              pointerRoute.current = {
                fromX: event.clientX, fromY: event.clientY,
                toX: child.dataset.side === 'left' ? bounds.right : bounds.left,
                top: bounds.top, bottom: bounds.bottom, expires: Date.now() + 300,
              };
            }}
            onClick={() => activate(index)}>
            {selected && <span className="nb-status-menu-check"><Check size={14} aria-hidden="true" /></span>}
            <FileIcon fileName={entry.name} isDir={entry.isDir} isOpen={expanded} size={15} />
            <bdi>{entry.name}</bdi>
            {entry.isDir && <ChevronRight size={13} className="nb-status-menu-arrow" aria-hidden="true" />}
          </div>;
          if (!entry.isDir) return <Fragment key={entry.path}>{item}</Fragment>;
          const closeChild = (restoreFocus: boolean) => {
            setSubmenu(previous => previous?.index === index ? undefined : previous);
            if (restoreFocus) content.current?.focus({ preventScroll: true });
          };
          return <Popover.Root key={entry.path} open={expanded} onOpenChange={open => { if (!open) closeChild(false); }}>
            <Popover.Anchor asChild>{item}</Popover.Anchor>
            <Popover.Portal>
              <DirectoryMenu path={entry.path} label={`${entry.name} 文件和文件夹`} hidden={hidden} currentPath={currentPath} closeRoot={closeRoot} closeSubmenu={closeChild}
                onFile={onFile} takeFocus={!!submenu?.takeFocus} id={childId} />
            </Popover.Portal>
          </Popover.Root>;
        })}
      </div>
      {overflow > 0 && <div className="nb-status-directory-message nb-status-directory-overflow" role="status">另有 {overflow} 项</div>}
    </div>
  </Popover.Content>;
}
