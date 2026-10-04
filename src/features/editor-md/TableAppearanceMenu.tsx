import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Grid3X3, RotateCcw } from 'lucide-react';
import { tableStyle, documentTableStyle, type TableStyle } from './documentPresentation';
import { setDocumentTableStyle } from './documentPresentationCommands';
import './tableControls.css';
import { useHoverMenu, HoverMenuContext } from '../../components/useHoverMenu';
import { useNativeFeatureVisibility } from '../document-format/featureGate';
import { Tooltip } from '../../components/Tooltip';

function ThreeLineIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 4h18M3 10h18M3 20h18"/></svg>;
}
export function resetTableDimensions(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth); if (table.type.name !== 'table') continue;
    const start = $from.before(depth) + 1, tr = editor.state.tr;
    table.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.attrs.height != null) tr.setNodeMarkup(start + pos, undefined, { ...node.attrs, height: null });
      if (node.attrs.colwidth != null) tr.setNodeMarkup(start + pos, undefined, { ...node.attrs, colwidth: null });
    });
    if (tr.docChanged) editor.view.dispatch(tr);
    return;
  }
}

export function TableAppearanceMenu({ editor }: { editor: Editor }) {
  const visible = useNativeFeatureVisibility();
  const [open, setOpen] = useState(false);
  const hover = useHoverMenu(open, setOpen);
  const [style, setStyle] = useState(() => documentTableStyle(editor.state.doc));
  useEffect(() => {
    const update = () => setStyle(documentTableStyle(editor.state.doc));
    editor.on('transaction', update); return () => { editor.off('transaction', update); };
  }, [editor]);
  const choose = (value: string) => {
    const next = tableStyle(value);
    setDocumentTableStyle(editor, next);
    setOpen(false);
  };
  const styles: Array<{ value: TableStyle; label: string }> = [{ value: 'standard', label: '标准表' }, { value: 'three-line', label: '三线表' }];
  if (!visible) return null;
  return <Popover.Root modal={false} open={open} onOpenChange={hover.change}>
    <Popover.Trigger {...hover.triggerProps} className="nb-table-style-trigger" aria-label="表格样式" title="表格样式">
      {style === 'standard' ? <Grid3X3 size={16}/> : <ThreeLineIcon/>}<ChevronDown className="nb-menu-chevron" size={11}/>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content role="menu" className="nb-table-style-menu" sideOffset={6} align="end" collisionPadding={10}
      {...hover.contentProps} onOpenAutoFocus={hover.onOpenAutoFocus} onCloseAutoFocus={hover.onCloseAutoFocus}>
      <HoverMenuContext.Provider value={hover}>
      <div className="nb-table-style-label">全文表格样式</div>
      <div role="group">
        {styles.map(option => <Tooltip key={option.value} content={option.label} helpKey={option.value === 'standard' ? 'table.style.standard' : 'table.style.three-line'} side="right"><button type="button" role="menuitemradio" aria-checked={style === option.value} data-state={style === option.value ? 'checked' : 'unchecked'} onClick={() => choose(option.value)}>
          {option.value === 'standard' ? <Grid3X3 size={16}/> : <ThreeLineIcon/>}{option.label}
        </button></Tooltip>)}
      </div>
      <div role="separator" style={{ height: 1, margin: '5px 4px', background: 'var(--editor-border)' }}/>
      <button type="button" title="重置当前表尺寸" role="menuitem" onClick={() => { resetTableDimensions(editor); setOpen(false); }}><RotateCcw size={16}/>重置当前表尺寸</button>
      </HoverMenuContext.Provider>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
