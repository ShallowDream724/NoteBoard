// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { Folder, Save, Image as ImageIcon } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import * as ipc from '../../core/ipc/commands';
import { open } from '@tauri-apps/plugin-dialog';
import { showToast } from '../../stores/toastStore';
import { Tooltip } from '../Tooltip';
import { ImageDeletionSetting } from './ImageDeletionSetting';
import { inputStyle } from './SettingsControls';

export function FilePanel() {
  const { settings, setFile } = useSettingsStore();
  const handleChooseStagingDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') await setFile({ stagingDirectory: selected });
  };
  const handleResetStagingDirectory = async () => {
    const defaultDirectory = await ipc.getDefaultStagingDirectory();
    await setFile({ stagingDirectory: defaultDirectory });
  };
  const handleOpenStagingDirectory = async () => {
    try {
      await ipc.openStagingDirectory();
    } catch (error) {
      showToast(`无法打开暂存区：${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  };
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div>
      <h3 style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 14 / 13)', fontWeight: 600, marginBottom: 4 }}>文件与保存设置</h3>
      <p style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 12 / 13)', color: 'var(--editor-text-muted)', margin: 0 }}>
        独立配置 Markdown、自由画板与代码文本的自动保存策略，以及本地文件管理选项。
      </p>
    </div>

    {/* ── 4.1 自动保存设置 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div className="nb-settings-section-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
          <Save size={15} color="var(--accent-strong)" />
          <span>自动保存设置 (分类型独立配置)</span>
        </div>
        <span style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>默认关闭：使用 Ctrl+S 手动保存，关闭时自动拦截确认</span>
      </div>

      {/* Markdown 笔记自动保存 */}
      <label className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>Markdown 笔记自动保存</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>停止输入 800ms 后自动写入磁盘；未开启时需手动保存</div>
        </div>
        <input
          type="checkbox"
          checked={settings.file.autoSaveMarkdown ?? false}
          onChange={(e) => setFile({ autoSaveMarkdown: e.target.checked })}
        />
      </label>

      {/* 自由画板自动保存 */}
      <label className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>自由画板 (.board) 自动保存</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>绘制操作停止 800ms 后自动写入磁盘；未开启时需手动保存</div>
        </div>
        <input
          type="checkbox"
          checked={settings.file.autoSaveBoard ?? false}
          onChange={(e) => setFile({ autoSaveBoard: e.target.checked })}
        />
      </label>

      {/* 代码与文本自动保存 */}
      <label className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>代码与文本 (.sql / .json / .txt 等) 自动保存</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>编辑停止 800ms 后自动写入磁盘；未开启时需手动保存</div>
        </div>
        <input
          type="checkbox"
          checked={settings.file.autoSaveOther ?? false}
          onChange={(e) => setFile({ autoSaveOther: e.target.checked })}
        />
      </label>
    </div>

    {/* ── 4.2 文件与目录管理 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)' }}>
        <Folder size={15} color="var(--accent-strong)" />
        <span>文件树与会话选项</span>
      </div>

      {/* 显示隐藏文件 */}
      <label className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>显示隐藏文件 / 文件夹</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>在左侧文件树中显示以点（.）开头的隐藏文件或系统文件</div>
        </div>
        <input
          type="checkbox"
          checked={settings.file.showHiddenFiles ?? false}
          onChange={(e) => setFile({ showHiddenFiles: e.target.checked })}
        />
      </label>

      {/* 保留最近文件：启动时恢复到 Tab 栏，但当前页面仍停留 Home。 */}
      <label className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', cursor: 'pointer', padding: '4px 0' }}>
        <div>
          <div>保留最近文件</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>默认开启；启动时自动恢复到 Tab 栏，当前页面仍显示 Home</div>
        </div>
        <input
          type="checkbox"
          checked={settings.file.restoreSession ?? true}
          onChange={(e) => setFile({ restoreSession: e.target.checked })}
        />
      </label>

      {/* 大文件确认阈值 */}
      <div className="nb-settings-row" style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', padding: '2px 0' }}>
        <div>
          <div>大文件打开确认阈值 (MB)</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>超过此大小的文件在打开前将弹出性能提示</div>
        </div>
        <input
          type="number"
          min="1"
          max="100"
          value={settings.file.largeFileConfirmMb ?? 50}
          onChange={(e) => setFile({ largeFileConfirmMb: parseInt(e.target.value, 10) || 50 })}
          style={{ ...inputStyle, width: '5em', textAlign: 'center' }}
        />
      </div>
    </div>

    {/* ── 4.3 暂存目录设置 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', color: 'var(--editor-text)' }}>
        <Folder size={15} color="var(--accent-strong)" />
        <span>未保存文件暂存区</span>
      </div>
      <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)' }}>
        新建文件和有修改的文件会另存为“时间-序号-文件名”。编辑期间持续覆盖同一副本，正常保存后自动清理；暂存关闭或异常退出时保留。
      </div>
      <Tooltip content={settings.file.stagingDirectory ?? ''} disabled={!settings.file.stagingDirectory} side="top" sideOffset={4}>
        <input
          type="text"
          readOnly
          value={settings.file.stagingDirectory ?? ''}
          style={{ ...inputStyle, width: '100%', maxWidth: 'none', padding: '6px 10px' }}
        />
      </Tooltip>
      <div className="nb-settings-actions">
        <button type="button" className="nb-btn-secondary" onClick={handleChooseStagingDirectory}>选择位置</button>
        <button type="button" className="nb-btn-secondary" onClick={handleResetStagingDirectory}>恢复默认</button>
        <button type="button" className="nb-btn-secondary" onClick={handleOpenStagingDirectory}>在资源管理器中打开</button>
      </div>
    </div>

    {/* ── 4.4 图片目录设置 ── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', background: 'var(--editor-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--editor-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', color: 'var(--editor-text)' }}>
        <ImageIcon size={15} color="var(--accent-strong)" />
        <span>图片目录设置</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 13 / 13)', fontWeight: 500, color: 'var(--editor-text)' }}>图片目录名称</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size, 13px) * 11 / 13)', color: 'var(--editor-text-muted)', marginBottom: 2 }}>
          插入或粘贴本地图片时，自动在当前 Markdown 文档所在目录同一层创建的子文件夹名称（默认 <code>img</code>）
        </div>
        <input
          type="text"
          value={settings.file.imageDirName ?? 'img'}
          onChange={(e) => setFile({ imageDirName: e.target.value })}
          placeholder="img"
          style={{ ...inputStyle, width: '100%', maxWidth: 280, padding: '6px 10px' }}
        />
      </div>
      <ImageDeletionSetting />
    </div>
  </div>);
}
