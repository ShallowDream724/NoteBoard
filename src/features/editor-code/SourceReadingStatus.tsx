import { useCallback, useSyncExternalStore } from 'react';
import { WrapText } from 'lucide-react';
import { getEditorCapabilities, subscribeEditorCapabilities } from '../../core/editor/editorRegistry';
import { Tooltip } from '../../components/Tooltip';

const noSubscription = () => () => {};
const hidden = () => 'hidden' as const;

export function SourceReadingStatus({ docKey }: { docKey: string }) {
  const control = useSyncExternalStore(
    useCallback(listener => subscribeEditorCapabilities(key => { if (key === docKey) listener(); }), [docKey]),
    useCallback(() => getEditorCapabilities(docKey)?.codeView?.reading, [docKey]),
  );
  const status = useSyncExternalStore(control?.subscribe ?? noSubscription, control?.getSnapshot ?? hidden);
  if (status === 'hidden') return null;

  const active = status === 'reading';
  return <Tooltip content={active ? '恢复当前文件的编辑布局' : '展开当前文件的长行，仅改变显示'} side="top">
    <button type="button" className="nb-status-mode nb-status-field" aria-pressed={active}
      onClick={() => control?.toggle()}>
      <WrapText size={13} aria-hidden="true" />
      {active ? '结束阅读' : '长行阅读'}
    </button>
  </Tooltip>;
}
