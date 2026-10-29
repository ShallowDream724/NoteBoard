import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, Download, X } from 'lucide-react';
import authoringSkill from '../../../skills/noteboard-authoring/SKILL.md?raw';
import './authoring-guide.css';

/** One source is both the in-app reference and the portable AI skill. */
export function AuthoringGuideContent() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const run = async (action: 'copy' | 'save') => {
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const { copyText, exportBlobWithDialog } = await import('../export/chartExport');
      if (action === 'copy') {
        await copyText(authoringSkill);
        setMessage('已复制完整 Skill，可交给 AI 作为编写指南。');
      } else if (await exportBlobWithDialog(new Blob([authoringSkill], { type: 'text/markdown;charset=utf-8' }), 'SKILL.md', [{ name: 'Markdown', extensions: ['md'] }])) {
        setMessage('已保存 SKILL.md。');
      }
    } catch (error) {
      setFailed(true);
      setMessage(`${action === 'copy' ? '复制' : '保存'}失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return <section className="nb-authoring-guide">
    <header>
      <h3>AI 编写指南</h3>
      <p>把这份 Skill 交给 AI，让它用 Markdown 和 NoteBoard 声明式语法生成可编辑内容。</p>
    </header>
    <div className="nb-authoring-guide-actions">
      <button type="button" className="nb-btn-primary" disabled={busy} onClick={() => void run('copy')}><Copy size={14} aria-hidden="true" />复制完整 Skill</button>
      <button type="button" className="nb-btn-secondary" disabled={busy} onClick={() => void run('save')}><Download size={14} aria-hidden="true" />保存 SKILL.md</button>
    </div>
    <p className="nb-authoring-guide-hint">生成后粘贴到源码模式，用 Ctrl+/ 切换预览；日常编辑也可以使用短命令与 / 菜单。</p>
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'nb-authoring-guide-error' : 'nb-authoring-guide-status'}>{message}</p>}
    <label className="nb-authoring-guide-source-label" htmlFor="noteboard-authoring-skill">完整 Skill</label>
    <textarea id="noteboard-authoring-skill" className="nb-authoring-guide-source" readOnly spellCheck={false} value={authoringSkill} />
  </section>;
}

export function AuthoringGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="nb-authoring-guide-overlay" />
      <Dialog.Content className="nb-authoring-guide-dialog" data-shortcuts-suspended aria-describedby={undefined} onKeyDown={event => event.stopPropagation()}>
        <div className="nb-authoring-guide-dialog-header">
          <Dialog.Title>NoteBoard · AI 编写指南</Dialog.Title>
          <Dialog.Close asChild><button type="button" className="nb-btn-secondary" aria-label="关闭 AI 编写指南"><X size={16} /></button></Dialog.Close>
        </div>
        <div className="nb-authoring-guide-dialog-body"><AuthoringGuideContent /></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
