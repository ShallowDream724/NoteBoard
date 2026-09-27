import { useSettingsStore } from '../../stores/settingsStore';
import * as ipc from '../../core/ipc/commands';
import { open } from '@tauri-apps/plugin-dialog';
import { showToast } from '../../stores/toastStore';
import { Tooltip } from '../Tooltip';
import { ImageDeletionSetting } from './ImageDeletionSetting';
import { inputStyle, SettingRow, SettingsPanelHeading, SettingsSection } from './SettingsControls';

export function FilePanel() {
  const { settings: { file }, setFile } = useSettingsStore();
  const handleChooseStagingDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') await setFile({ stagingDirectory: selected });
  };
  const handleResetStagingDirectory = async () => { await setFile({ stagingDirectory: await ipc.getDefaultStagingDirectory() }); };
  const handleOpenStagingDirectory = async () => {
    try { await ipc.openStagingDirectory(); }
    catch (error) { showToast(`无法打开暂存区：${error instanceof Error ? error.message : String(error)}`, 'error', 5000); }
  };
  return <div className="nb-settings-panel">
    <SettingsPanelHeading title="文件与保存" description="管理自动保存、文件列表和本地存储位置。"/>
    <SettingsSection title="自动保存" description="开启后，编辑停止 800ms 即保存到磁盘。关闭时可手动保存，关闭文件前会确认未保存的修改。">
      <SettingRow label="Markdown 笔记"><input type="checkbox" checked={file.autoSaveMarkdown ?? false} onChange={event => setFile({ autoSaveMarkdown: event.target.checked })}/></SettingRow>
      <SettingRow label="自由画板"><input type="checkbox" checked={file.autoSaveBoard ?? false} onChange={event => setFile({ autoSaveBoard: event.target.checked })}/></SettingRow>
      <SettingRow label="代码与纯文本"><input type="checkbox" checked={file.autoSaveOther ?? false} onChange={event => setFile({ autoSaveOther: event.target.checked })}/></SettingRow>
    </SettingsSection>
    <SettingsSection title="文件列表与会话">
      <SettingRow label="显示隐藏文件" description="在文件树中显示以点开头的文件与文件夹。"><input type="checkbox" checked={file.showHiddenFiles ?? false} onChange={event => setFile({ showHiddenFiles: event.target.checked })}/></SettingRow>
      <SettingRow label="保留最近文件" description="启动时恢复到标签栏，当前页面仍显示首页。"><input type="checkbox" checked={file.restoreSession ?? true} onChange={event => setFile({ restoreSession: event.target.checked })}/></SettingRow>
      <SettingRow label="大文件确认阈值" description="打开超过此大小的文件前显示提示，单位 MB。"><input type="number" min="1" max="100" value={file.largeFileConfirmMb ?? 50} onChange={event => setFile({ largeFileConfirmMb: parseInt(event.target.value, 10) || 50 })} style={{ ...inputStyle, width: '5em', textAlign: 'center' }}/></SettingRow>
    </SettingsSection>
    <SettingsSection title="未保存文件暂存区" description="编辑中的内容会保留暂存副本，正常保存后自动清理；暂存关闭或异常退出时保留。">
      <Tooltip content={file.stagingDirectory ?? ''} disabled={!file.stagingDirectory} side="top" sideOffset={4}>
        <input aria-label="未保存文件暂存区路径" type="text" readOnly value={file.stagingDirectory ?? ''} style={inputStyle}/>
      </Tooltip>
      <div className="nb-settings-actions">
        <button type="button" className="nb-btn-secondary" onClick={handleChooseStagingDirectory}>选择位置</button>
        <button type="button" className="nb-btn-secondary" onClick={handleResetStagingDirectory}>恢复默认</button>
        <button type="button" className="nb-btn-secondary" onClick={handleOpenStagingDirectory}>打开文件夹</button>
      </div>
    </SettingsSection>
    <SettingsSection title="图片存储">
      <SettingRow label="图片目录名称" description="插入或粘贴图片时，在 Markdown 文件旁创建此文件夹。"><input type="text" value={file.imageDirName ?? 'img'} onChange={event => setFile({ imageDirName: event.target.value })} placeholder="img" style={{ ...inputStyle, width: '10em' }}/></SettingRow>
      <ImageDeletionSetting/>
    </SettingsSection>
  </div>;
}
