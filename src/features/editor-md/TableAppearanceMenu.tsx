import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Grid3X3, RotateCcw } from 'lucide-react';
import { tableStyle, documentTableStyle, setDocumentTableStyle, type TableStyle } from './documentPresentation';
import './tableControls.css';

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
  const [style, setStyle] = useState(() => documentTableStyle(editor.state.doc));
  useEffect(() => {
    const update = () => setStyle(documentTableStyle(editor.state.doc));
    editor.on('transaction', update); return () => { editor.off('transaction', update); };
  }, [editor]);
  const choose = (value: string) => {
    const next = tableStyle(value);
    setDocumentTableStyle(editor, next);
  };
  const styles: Array<{ value: TableStyle; label: string }> = [{ value: 'standard', label: '标准表' }, { value: 'three-line', label: '三线表' }];
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger className="nb-table-style-trigger" aria-label="表格样式" title="全文表格样式">
      {style === 'standard' ? <Grid3X3 size={16}/> : <ThreeLineIcon/>}<ChevronDown size={11}/>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="nb-table-style-menu" sideOffset={6} align="end" collisionPadding={10}
      onCloseAutoFocus={event => { event.preventDefault(); editor.view.focus(); }}>
      <DropdownMenu.Label className="nb-table-style-label">全文表格样式</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={style} onValueChange={choose}>
        {styles.map(option => <DropdownMenu.RadioItem key={option.value} value={option.value}>
          {option.value === 'standard' ? <Grid3X3 size={16}/> : <ThreeLineIcon/>}{option.label}
        </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator style={{ height: 1, margin: '5px 4px', background: 'var(--editor-border)' }}/>
      <DropdownMenu.Item onSelect={() => resetTableDimensions(editor)}><RotateCcw size={16}/>重置当前表尺寸</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
