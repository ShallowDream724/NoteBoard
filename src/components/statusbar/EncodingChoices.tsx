import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { TEXT_ENCODINGS, type Encoding } from '../../core/ipc/types';
import './statusMenus.css';

export function EncodingChoices({ current, onChoose, nativeWrite }: {
  current?: Encoding; onChoose: (id: Encoding) => void; nativeWrite?: boolean;
}) {
  const choices = nativeWrite ? TEXT_ENCODINGS.filter(choice => choice.id === 'utf8') : TEXT_ENCODINGS;
  return <Menu.RadioGroup value={current}>
    {choices.map(({ id, label }) =>
      <Menu.RadioItem key={id} value={id} className="nb-status-menu-item"
        title={nativeWrite ? 'NoteBoard 文档使用 UTF-8 保存' : undefined} onSelect={() => onChoose(id)}>
        <Menu.ItemIndicator className="nb-status-menu-check"><Check size={14} /></Menu.ItemIndicator>
        {label}
      </Menu.RadioItem>)}
  </Menu.RadioGroup>;
}
