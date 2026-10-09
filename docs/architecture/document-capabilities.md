# 文档能力与转换入口

`src/features/document-format/capabilities.ts` 是编辑功能的格式边界：普通文字、基础格式、图片和普通表格可直接用于 Markdown；文字颜色、高亮、字号、任意对齐、表格尺寸/底色/合并、图片组合和说明等需要 NB。能力描述同时声明资源、PDF、Pandoc 和通用 Markdown 投影语义。

## 调用约定

- 同步命令使用 `runWithDocumentCapability(editor, capability, action)`。NB 立即执行；MD 先确认转换，成功后用新编辑器执行 `action`。不能在回调中继续使用转换前的编辑器。
- 异步导入先调用 `ensureDocumentCapability`，只有得到非空编辑器后才能提交内容。没有文档身份的 MD 编辑器拒绝增强操作；测试中的 NB 编辑器必须显式初始化 NB 格式。
- 转换默认保留并关联原 Markdown；“删除原 Markdown，不再关联”默认关闭。取消、转换失败和确认期间源内容变化均不执行原操作。
- 新编辑器通过 `subscribeMdTipTapEditors` 注册事件取得，转换后恢复原选区。重复按键/拖拽事件不会在转换弹窗后堆积执行。

`DocumentCapabilityGuard` 为视觉编辑器的直接 TipTap 命令、快捷键、粘贴和尺寸拖拽提供事务检查。它只检查新增 marks、属性和替换片段，普通输入不扫描全文；已读取的 HTML 样式、普通表格操作、选区事务与显式历史恢复不触发转换。被拦截事务仅在新 NB 的基准文档仍一致时重放。转换入口与事务回放共用 `documentComparison.sameDocument`，按节点/标记名称及属性比较语义，并归一图片和链接相对路径，不分配两份完整 JSON 文档树。回放使用步骤 JSON 和新编辑器 schema 重建步骤与 stored marks，一次提交且可独立撤销；不能复用旧 schema 的节点或标记实例。

外部 HTML 普通粘贴采用目标格式策略：MD 保留文字、链接、基础格式、列表、表格、图片与公式，忽略网页颜色、高亮、对齐和单元格底色；图注展开为紧随图片的普通段落，合并单元格按稀疏逻辑网格展开，原文字只保留一次。NB 继续保留可识别的丰富外观。`ExternalHtmlOptions.preservePresentation` 默认为 `true`，主编辑器的 MD 外部 HTML 入口传 `false`；小输入与 Worker 共用规范化实现，大输入无需先在主线程构建或二次解析整份剪贴板。内部结构化 MIME 与显式 Markdown 来源保持其结构，并由能力门控决定是否转换。Ctrl+Shift+V 始终走纯文本入口，不推断 Markdown/表格或读取 HTML 外观。

网页相对链接、锚点和图片共用 URL 解析策略：仅根据 CF_HTML `SourceURL`、调用方提供的 `sourceUrl` 或有效 HTTP(S) `<base>` 补齐地址，不借用本地编辑器/解析器的页面 URL。缺少来源时保留原相对路径；显式 Markdown 和内部 MIME 的本地路径不经过网页基址转换。URL allowlist 在主线程和 Worker 共用，解析不触发资源下载。

工具栏、选区菜单、内容块菜单和图片节点菜单使用相同命令入口。图片拖拽只预览尺寸，松开后提交一次可撤销修改。NB 源码不显示 Markdown 格式化工具栏；Markdown 源码不显示私有样式入口。

## 偏好与关联提示

`settings.editor.pureMarkdown` 默认为 `false`，Rust 缺失字段也按 `false` 读取。打开该偏好会隐藏 NB 专属编辑及新建入口，默认新建 Markdown；关闭时默认新建 NB。该偏好不改变现有 NB 的格式或阅读能力。

只有 NB 存在有效 Markdown 关联时，工具栏显示“更新关联 Markdown”，直接复用现有保存服务。关联 Markdown 的外部变更存在冲突时，`LinkedMarkdownBanner` 订阅冲突状态并提供查看 Markdown 或保留 NB 后更新 Markdown 的选择；确认接受最新外部版本后才调用同一个保存服务。
