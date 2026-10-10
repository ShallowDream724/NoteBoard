import type { Editor } from '@tiptap/core';
import { Copy, RemoveFormatting, Scissors, Trash2, Type } from 'lucide-react';
import { Tooltip } from '../../components/Tooltip';
import { showToast } from '../../stores/toastStore';
import { useResolvedShortcutLabel } from '../../core/useShortcutBindings';
import { writeDocumentClipboard } from './clipboard/clipboardImport';
import { dispatchDiscreteEdit, runDiscreteEdit } from './discreteEdit';
import { clearSelectionTextFormatting, supportsBlockTextFormatting, hasCaptionTextFormatting } from './textFormatting';
import { resolveBlockSelection, type BlockSelection } from './blockSelection';
import { NumberingControl } from './numbering/NumberingControl';
import './blockContextMenu.css';

/** A menu snapshot is usable only while its document is current. No cached
 * document/position mapping is needed for this short-lived interaction. */
export function restoreBlockSelection(editor: Editor, selection: BlockSelection): boolean {
  if (selection.selection.$from.doc !== editor.state.doc) return false;
  if (!editor.state.selection.eq(selection.selection)) editor.view.dispatch(editor.state.tr.setSelection(selection.selection).setMeta('addToHistory', false));
  return true;
}

export function copyBlockSelection(editor: Editor, selection: BlockSelection, cut = false): boolean {
  if (!restoreBlockSelection(editor, selection)) return false;
  let copied = false;
  const write = (event: ClipboardEvent) => {
    copied = writeDocumentClipboard(editor.view, event, cut);
    if (copied) event.stopImmediatePropagation();
  };
  document.addEventListener('copy', write, true);
  try { editor.view.focus(); document.execCommand('copy'); }
  finally { document.removeEventListener('copy', write, true); }
  return copied;
}

export function BlockSelectionMenu({ editor, selection: suppliedSelection, close }: { editor: Editor; selection?: BlockSelection; close: () => void }) {
  const restoreShortcut = useResolvedShortcutLabel('Ctrl+0'), clearShortcut = useResolvedShortcutLabel('Ctrl+\\');
  const selection = suppliedSelection ?? resolveBlockSelection(editor.state);
  if (!selection) return null;
  const canClear = selection.items.some(item => supportsBlockTextFormatting(item.node) || hasCaptionTextFormatting(item.node) || item.node.attrs.concealed === true);
  const canRestore = selection.items.some(item => ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'githubAlert', 'disclosure'].includes(item.node.type.name));
  const canNumber = selection.items.every(item => ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem'].includes(item.node.type.name));
  const allNumbered = selection.items.every(item => item.node.type.name === 'orderedList' || item.node.type.name === 'listItem' && editor.state.doc.resolve(item.pos).parent.type.name === 'orderedList');
  const action = (run: () => unknown) => { if (restoreBlockSelection(editor, selection)) run(); close(); };
  const copy = (cut: boolean) => { if (!copyBlockSelection(editor, selection, cut)) showToast('无法写入剪贴板，请用键盘快捷键重试', 'warning'); close(); };
  return <div className="nb-block-context-menu" role="menu" aria-label={`${selection.count} 个内容块操作`} onPointerDown={event => event.preventDefault()}>
    {canNumber && <NumberingControl editor={editor} targetSelection={selection.selection} variant="overflow" onDone={close}
      active={allNumbered} actionLabel={allNumbered ? '取消有序列表' : '改为有序列表'}
      onToggle={() => action(() => allNumbered ? runDiscreteEdit(editor, chain => chain.focus().restoreParagraph()) : editor.chain().focus().toggleOrderedList().run())}/>}
    <Tooltip content="清除文字样式" helpKey="format.clear" shortcut={'Ctrl+\\'} side="right"><button role="menuitem" type="button" disabled={!canClear} onClick={() => action(() => clearSelectionTextFormatting(editor))}><RemoveFormatting size={16}/>清除文字样式{clearShortcut && <kbd className="nb-block-menu-shortcut">{clearShortcut.split(' / ')[0]}</kbd>}</button></Tooltip>
    <Tooltip content="还原为正文" helpKey="format.restore" shortcut="Ctrl+0" side="right"><button role="menuitem" type="button" disabled={!canRestore} onClick={() => action(() => runDiscreteEdit(editor, chain => chain.restoreParagraph()))}><Type size={16}/>还原为正文{restoreShortcut && <kbd className="nb-block-menu-shortcut">{restoreShortcut.split(' / ')[0]}</kbd>}</button></Tooltip>
    <hr/>
    <button role="menuitem" type="button" onClick={() => copy(true)}><Scissors size={16}/>剪切</button>
    <button role="menuitem" type="button" onClick={() => copy(false)}><Copy size={16}/>复制</button>
    <button role="menuitem" type="button" onClick={() => action(() => { dispatchDiscreteEdit(editor.view, editor.state.tr.deleteSelection()); editor.view.focus(); })}><Trash2 size={16}/>删除所选内容</button>
  </div>;
}
