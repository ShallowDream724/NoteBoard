# 文档能力与转换入口

`src/features/document-format/capabilities.ts` 是编辑功能的格式边界：普通文字、基础格式、图片和普通表格可直接用于 Markdown；文字颜色、高亮、字号、任意对齐、表格尺寸/底色/合并、图片组合和说明等需要 NB。能力描述同时声明资源、PDF、Pandoc 和通用 Markdown 投影语义。

## 调用约定

- 同步命令使用 `runWithDocumentCapability(editor, capability, action)`。NB 立即执行；MD 先确认转换，成功后用新编辑器执行 `action`。不能在回调中继续使用转换前的编辑器。
- 异步导入先调用 `ensureDocumentCapability`，只有得到非空编辑器后才能提交内容。没有文档身份的 MD 编辑器拒绝增强操作；测试中的 NB 编辑器必须显式初始化 NB 格式。
- 转换默认保留并关联原 Markdown；“删除原 Markdown，不再关联”默认关闭。取消、转换失败和确认期间源内容变化均不执行原操作。
- 新编辑器通过 `subscribeMdTipTapEditors` 注册事件取得，转换后恢复原选区。重复按键/拖拽事件不会在转换弹窗后堆积执行。

`DocumentCapabilityGuard` 为视觉编辑器的直接 TipTap 命令、快捷键、粘贴和尺寸拖拽提供事务检查。它只检查新增 marks、属性和替换片段，普通输入不扫描全文；已读取的 HTML 样式、普通表格操作、选区事务与显式历史恢复不触发转换。被拦截事务仅在新 NB 的基准文档仍一致时重放。

工具栏、选区菜单、内容块菜单和图片节点菜单使用相同命令入口。图片拖拽只预览尺寸，松开后提交一次可撤销修改。NB 源码不显示 Markdown 格式化工具栏；Markdown 源码不显示私有样式入口。

## 偏好与关联提示

`settings.editor.pureMarkdown` 默认为 `false`，Rust 缺失字段也按 `false` 读取。打开该偏好会隐藏 NB 专属编辑及新建入口，默认新建 Markdown；关闭时默认新建 NB。该偏好不改变现有 NB 的格式或阅读能力。

只有 NB 存在有效 Markdown 关联时，工具栏显示“更新关联 Markdown”，直接复用现有保存服务。关联 Markdown 的外部变更存在冲突时，`LinkedMarkdownBanner` 订阅冲突状态并提供查看 Markdown 或保留 NB 后更新 Markdown 的选择；确认接受最新外部版本后才调用同一个保存服务。
