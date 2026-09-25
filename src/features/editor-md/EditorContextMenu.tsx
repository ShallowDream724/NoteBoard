import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { Clipboard, ClipboardType, Copy, Scissors, TextSelect } from 'lucide-react';
import { useMenuBounds } from '../../components/useMenuBounds';
import { showToast } from '../../stores/toastStore';
import { pasteFromSystemClipboard } from './clipboard/systemClipboard';
import './editorContextMenu.css';

interface EditorContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  hasSelection: boolean;
  onClose: () => void;
}

/** Clipboard actions only. Formatting belongs to the selection toolbar and block menu. */
export function EditorContextMenu({ editor, position, hasSelection, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuBounds(menuRef, true, position.x, position.y);

  useEffect(() => {
    menuRef.current?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('scroll', dismissOutside, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('scroll', dismissOutside, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, position.x, position.y]);

  const run = (action: () => unknown) => {
    // Synchronous view focus restores the DOM selection before the native copy/cut event.
    // The existing clipboard plugins own rich slices, notes, tables and undo.
    editor.view.focus();
    try { void action(); } finally { onClose(); }
  };
  const copy = (cut: boolean) => {
    if (!document.execCommand(cut ? 'cut' : 'copy')) {
      showToast('无法写入剪贴板，请用键盘快捷键重试', 'warning');
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (['a', 'v'].includes(key) || (hasSelection && ['c', 'x'].includes(key))) {
        event.preventDefault(); event.stopPropagation();
        run(() => key === 'a' ? editor.commands.selectAll() : key === 'v' ? pasteFromSystemClipboard(editor, event.shiftKey) : copy(key === 'x'));
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onClose(); editor.view.focus();
      return;
    }
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[next]?.focus({ preventScroll: true });
  };

  return createPortal(<div ref={menuRef} className="nb-editor-context-menu" role="menu" aria-label="编辑操作" tabIndex={-1}
    style={{ left: position.x, top: position.y }} data-menu-min-width="228px" onKeyDown={handleKeyDown}
    onMouseDown={event => event.preventDefault()} onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    {hasSelection && <>
      <button type="button" role="menuitem" onClick={() => run(() => copy(true))}><Scissors size={16}/><span>剪切</span><kbd>Ctrl+X</kbd></button>
      <button type="button" role="menuitem" onClick={() => run(() => copy(false))}><Copy size={16}/><span>复制</span><kbd>Ctrl+C</kbd></button>
    </>}
    <button type="button" role="menuitem" onClick={() => run(() => pasteFromSystemClipboard(editor))}><Clipboard size={16}/><span>粘贴</span><kbd>Ctrl+V</kbd></button>
    <button type="button" role="menuitem" onClick={() => run(() => pasteFromSystemClipboard(editor, true))}><ClipboardType size={16}/><span>仅粘贴文本</span><kbd>Ctrl+Shift+V</kbd></button>
    <div role="separator"/>
    <button type="button" role="menuitem" onClick={() => run(() => editor.commands.selectAll())}><TextSelect size={16}/><span>全选</span><kbd>Ctrl+A</kbd></button>
  </div>, document.body);
}
