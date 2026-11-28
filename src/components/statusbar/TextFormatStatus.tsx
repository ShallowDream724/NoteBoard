import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { TEXT_ENCODINGS, type Eol } from '../../core/ipc/types';
import type { Document } from '../../stores/documentStore';
import { showToast } from '../../stores/toastStore';
import { EncodingChoices } from './EncodingChoices';

type FormatActions = typeof import('../../features/editor-code/orchestration/textFileFormat');

async function runAction(action: (actions: FormatActions) => Promise<boolean>) {
  try {
    await action(await import('../../features/editor-code/orchestration/textFileFormat'));
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  }
}

const field = 'nb-status-mode nb-status-field nb-status-format';
const lineEndings: Eol[] = ['lf', 'crlf'];

export function TextFormatStatus({ doc, detached }: { doc: Document; detached: boolean }) {
  if (doc.content == null) return null;
  const encoding = TEXT_ENCODINGS.find(choice => choice.id === doc.encoding)?.shortLabel ?? doc.encoding;
  const ending = doc.eol.toUpperCase();
  if (doc.kind !== 'code' && doc.kind !== 'markdown' && doc.kind !== 'noteboard') return <>
    <span className="nb-status-field nb-status-encoding">{encoding}</span>
    <span className="nb-status-field nb-status-encoding">{ending}</span>
  </>;

  const onDisk = !doc.key.startsWith('untitled:') && !detached && doc.externalStatus !== 'deleted';
  const writable = !doc.readonly;
  return <>
    <Menu.Root modal={false}>
      <Menu.Trigger className={field} aria-label={`文件编码：${encoding}`} title="文件编码">
        {encoding}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="nb-status-menu" side="top" align="end" collisionPadding={8} sideOffset={4} data-shortcuts-suspended>
          <Menu.Sub>
            <Menu.SubTrigger className="nb-status-menu-item" disabled={!onDisk}>
              通过编码重新打开<ChevronRight className="nb-status-menu-arrow" size={14} />
            </Menu.SubTrigger>
            <Menu.Portal><Menu.SubContent className="nb-status-menu" sideOffset={3} collisionPadding={8} data-shortcuts-suspended aria-label="通过编码重新打开">
              <EncodingChoices current={doc.encoding} onChoose={id => void runAction(actions => actions.reopenFileWithEncoding(doc.key, id))} />
            </Menu.SubContent></Menu.Portal>
          </Menu.Sub>
          <Menu.Sub>
            <Menu.SubTrigger className="nb-status-menu-item" disabled={!writable || doc.externalStatus === 'modified'}>
              通过编码保存<ChevronRight className="nb-status-menu-arrow" size={14} />
            </Menu.SubTrigger>
            <Menu.Portal><Menu.SubContent className="nb-status-menu" sideOffset={3} collisionPadding={8} data-shortcuts-suspended aria-label="通过编码保存">
              <EncodingChoices current={doc.encoding} nativeWrite={doc.kind === 'noteboard'} onChoose={id => void runAction(actions => actions.saveFileWithEncoding(doc.key, id))} />
            </Menu.SubContent></Menu.Portal>
          </Menu.Sub>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
    <Menu.Root modal={false}>
      <Menu.Trigger className={field} disabled={!writable} aria-label={`行尾符：${ending}`} title="行尾符">{ending}</Menu.Trigger>
      <Menu.Portal><Menu.Content className="nb-status-menu nb-status-menu-narrow" side="top" align="end" sideOffset={4} collisionPadding={8} data-shortcuts-suspended>
        <Menu.RadioGroup value={doc.eol}>
          {lineEndings.map(value => <Menu.RadioItem key={value} value={value} className="nb-status-menu-item"
            onSelect={() => { if (value !== doc.eol) void runAction(actions => actions.changeFileEol(doc.key, value)); }}>
            <Menu.ItemIndicator className="nb-status-menu-check"><Check size={14} /></Menu.ItemIndicator>{value.toUpperCase()}
          </Menu.RadioItem>)}
        </Menu.RadioGroup>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
  </>;
}
