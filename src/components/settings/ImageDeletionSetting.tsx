import { useId } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

/** The image cleanup preference edits the same persisted policy used by the removal dialog. */
export function ImageDeletionSetting() {
  const id = useId();
  const policy = useSettingsStore((state) => state.settings.file.imageDeletionPolicy ?? 'ask');
  const setFile = useSettingsStore((state) => state.setFile);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <label htmlFor={id} style={{ fontSize: 'var(--settings-font-base)', fontWeight: 500, color: 'var(--editor-text)' }}>从正文移除图片时</label>
    <select id={id} value={policy}
      onChange={(event) => setFile({ imageDeletionPolicy: event.target.value as 'ask' | 'keep' | 'trash' })}
      style={{ width: '100%', minWidth: 0, maxWidth: '28em', padding: '6px 10px', fontSize: 'var(--settings-font-sm)', border: '1px solid var(--editor-border)', borderRadius: 4, color: 'var(--editor-text)', background: 'var(--editor-bg)' }}>
      <option value="ask">每次询问是否同步删除图片文件</option>
      <option value="keep">始终保留图片文件</option>
      <option value="trash">下次保存成功后移入回收站</option>
    </select>
    <p style={{ fontSize: 'var(--settings-font-xs)', color: 'var(--editor-text-muted)', margin: 0 }}>
      仅清理图片目录中未被引用的文件，不会替你保存正文；保存前撤销或放弃修改会保留图片。
    </p>
  </div>;
}
