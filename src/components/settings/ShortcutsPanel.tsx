// Canonical settings panel; SettingsModal owns navigation and dismissal.
import { ShortcutItem } from './SettingsControls';

export function ShortcutsPanel() {

  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>快捷键一览</h3>
      <p style={{ fontSize: 12, color: 'var(--editor-text-muted)', margin: 0 }}>
        支持选中文本局部操作或全文操作，兼容 VS Code 与 JetBrains 常用快捷键。
      </p>
    </div>

    {/* JSON 与代码快捷操作 */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', marginBottom: 4 }}>
        JSON 与纯文本快捷处理 (.json / .txt / 源码模式)
      </div>
      <ShortcutItem keyCombo="Shift + Alt + F / Ctrl + Alt + L" label="JSON 展开 / 格式化（支持选区 / 全文）" />
      <ShortcutItem keyCombo="Shift + Alt + M / Ctrl + Alt + M" label="JSON 压缩为单行（支持选区 / 全文）" />
      <ShortcutItem keyCombo="Shift + Alt + V / Ctrl + Alt + V" label="JSON 格式校验与错误定位（支持选区 / 全文）" />
    </div>

    {/* 代码与纯文本编辑器快捷操作 */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', marginBottom: 4 }}>
        代码与纯文本编辑器 (.json / .txt / .sql 等)
      </div>
      <ShortcutItem keyCombo="Ctrl + 滚轮" label="实时缩放编辑器字号" />
    </div>

    {/* 查找与替换 */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', marginBottom: 4 }}>
        查找与替换
      </div>
      <ShortcutItem keyCombo="Ctrl + F" label="查找文本" />
      <ShortcutItem keyCombo="Ctrl + H" label="替换文本" />
    </div>

    {/* 全局与文件操作 */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', marginBottom: 4 }}>
        全局与文件操作
      </div>
      <ShortcutItem keyCombo="Ctrl + O" label="打开文件" />
      <ShortcutItem keyCombo="Ctrl + Shift + O" label="打开文件夹" />
      <ShortcutItem keyCombo="Ctrl + Shift + N" label="新建空窗口" />
      <ShortcutItem keyCombo="Ctrl + S" label="保存当前文档" />
      <ShortcutItem keyCombo="Ctrl + Shift + S" label="文档另存为" />
      <ShortcutItem keyCombo="Ctrl + W" label="关闭当前标签页" />
      <ShortcutItem keyCombo="Ctrl + Shift + B" label="展开/收起左侧栏" />
      <ShortcutItem keyCombo="Ctrl + Alt + B" label="展开/收起右侧栏（Markdown）" />
    </div>

    {/* Markdown 编辑 */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-strong)', marginBottom: 4 }}>
        Markdown 编辑
      </div>
      <ShortcutItem keyCombo="/" label="Markdown 中触发斜杠快捷插入" />
      <ShortcutItem keyCombo="Ctrl + B" label="加粗" />
    </div>
  </div>);
}
