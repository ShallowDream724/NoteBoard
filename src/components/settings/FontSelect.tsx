import { useId, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Search, Loader2, Check, X } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { filterFonts, loadFontCatalog, useFontCatalog, type FontFilterCategory } from './fontCatalog';
import './fontSelect.css';

export type { FontFilterCategory } from './fontCatalog';
interface FontSelectProps {
  value: string; onChange: (font: string) => void; label?: string;
  isMonospaceOnly?: boolean; filterType?: FontFilterCategory; placeholder?: string;
}

export function FontSelect({ value, onChange, label, isMonospaceOnly = false, filterType, placeholder = '选择或输入字体' }: FontSelectProps) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <div className="nb-font-select" data-open={open || undefined}>
        <Popover.Trigger asChild>
          <button type="button" className="nb-font-trigger" aria-label={label ?? placeholder}>
            <span className="nb-font-name" style={{ fontFamily: value ? `"${value}", var(--ui-font-family)` : undefined, color: value ? undefined : 'var(--editor-text-muted)' }}>{value || placeholder}</span>
            <ChevronDown size={14} />
          </button>
        </Popover.Trigger>
        {value && <Tooltip content="恢复系统默认"><button type="button" className="nb-font-reset" aria-label={`${label ?? '字体'}：恢复系统默认`} onClick={() => onChange('')}><X size={13} /></button></Tooltip>}
      </div>
    </Popover.Anchor>
    <Popover.Portal>
      <FontMenu value={value} label={label} initialCategory={filterType ?? (isMonospaceOnly ? 'mono' : 'all')}
        choose={font => { onChange(font); setOpen(false); }} />
    </Popover.Portal>
  </Popover.Root>;
}

/** Mounted only while the portal is open; async loading can never refocus a closed picker. */
function FontMenu({ value, label, initialCategory, choose }: {
  value: string; label?: string; initialCategory: FontFilterCategory; choose: (font: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontFilterCategory>(initialCategory);
  const [active, setActive] = useState(-1);
  const catalog = useFontCatalog(true);
  const fonts = useMemo(() => filterFonts(catalog.fonts, category, query), [catalog.fonts, category, query]);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const virtualizer = useVirtualizer({ count: fonts.length + 1, getScrollElement: () => list.current, estimateSize: () => 40, overscan: 4 });
  const navigate = (index: number) => {
    const next = Math.max(0, Math.min(fonts.length, index));
    setActive(next); virtualizer.scrollToIndex(next, { align: 'auto' });
  };
  return <Popover.Content className="nb-font-menu" data-shortcuts-suspended side="bottom" align="start" sideOffset={6} collisionPadding={12}
        aria-label={`${label ?? '字体'}选择`} onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus({ preventScroll: true }); }}>
        <div className="nb-font-search">
          <Search size={14} />
          <input ref={search} role="combobox" aria-label="搜索或输入字体名称" aria-autocomplete="list" aria-expanded="true" aria-controls={id}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            placeholder="搜索或输入字体名称" value={query} onChange={event => { setQuery(event.target.value); setActive(-1); virtualizer.scrollToOffset(0); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); navigate(active < 0 ? 0 : active + (event.key === 'ArrowDown' ? 1 : -1)); }
              if (event.key === 'Enter') {
                event.preventDefault();
                if (active === 0) choose('');
                else if (active > 0 && fonts[active - 1]) choose(fonts[active - 1].family);
                else if (query.trim()) choose(query.trim());
              }
            }} />
        </div>
        <div className="nb-font-categories" aria-label="字体分类">
          {([{ key: 'all', label: '全部' }, { key: 'zh', label: '中文' }, { key: 'en', label: '西文' }, { key: 'mono', label: '等宽' }] as const).map(item =>
            <button type="button" key={item.key} aria-pressed={category === item.key} onClick={() => { setCategory(item.key); setActive(-1); virtualizer.scrollToOffset(0); }}>{item.label}</button>)}
        </div>
        {catalog.loading && <div className="nb-font-status" role="status"><Loader2 size={14} className="animate-spin" />读取系统字体…</div>}
        {catalog.error && <div className="nb-font-status" role="status">{catalog.error}<button type="button" onClick={() => void loadFontCatalog()}>重试</button></div>}
        <div ref={list} className="nb-font-list" role="listbox" id={id} aria-label="字体列表">
          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map(item => {
              const font = item.index === 0 ? null : fonts[item.index - 1];
              const selected = value === (font?.family ?? '');
              return <button type="button" role="option" aria-selected={selected} tabIndex={-1}
                id={`${id}-${item.index}`} key={item.key} data-index={item.index} ref={virtualizer.measureElement}
                className="nb-font-option" data-active={active === item.index || undefined}
                style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${item.start}px)` }}
                onClick={() => choose(font?.family ?? '')}>
                <span className="nb-font-name" style={{ fontFamily: font ? `"${font.family}", sans-serif` : undefined }}>{font?.family ?? '系统默认（跟随系统）'}</span>
                {font && catalog.applicationFonts.has(font.family.toLowerCase()) && <small>应用字体</small>}
                {font?.isMonospace && <small>等宽</small>}{selected && <Check size={14} />}
              </button>;
            })}
          </div>
        </div>
        {query.trim() && <button type="button" className="nb-font-custom" onClick={() => choose(query.trim())}>使用“{query.trim()}”</button>}
      </Popover.Content>;
}
