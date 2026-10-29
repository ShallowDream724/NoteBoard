# 文档能力与转换入口

`src/features/document-format/capabilities.ts` 是编辑功能的格式边界：普通文字、基础格式、图片和普通表格使用 Markdown 原生表达；文字颜色、高亮、字号、任意对齐、表格尺寸/底色/合并、图片组合和说明等增强能力标为 `declarative`，可直接保存于 MD，不强制转为 NB。公开简写未覆盖的原生结构使用保留语法承载。能力描述同时声明资源、PDF、Pandoc 和独立的通用 Markdown 投影语义，源码与磁盘边界见 [声明式编写](declarative-authoring.md)。

## 调用约定

- 同步命令使用 `runWithDocumentCapability(editor, capability, action)`。格式支持该能力时立即用当前编辑器执行；MD 支持 `native/html/declarative`，仅 `requires-noteboard` 需要转换确认。
- 异步导入先调用 `ensureDocumentCapability`，只有得到非空编辑器后才能提交内容。支持的能力直接返回当前编辑器；仅进入转换分支时才要求文档身份、等待新 NB 编辑器并恢复原选区。
- 当前登记的增强能力均为 `declarative`。转换分支仍为将来明确要求 NB 的能力保留，使用 `subscribeMdTipTapEditors` 获取新编辑器，不在回调中复用旧编辑器。
- 用户明确转换格式时，默认保留并关联原 Markdown；“删除原 Markdown，不再关联”默认关闭。取消、转换失败和确认期间源内容变化均不执行原操作；重复按键/拖拽不在转换弹窗后堆积执行。

`DocumentCapabilityGuard` 为视觉编辑器的直接 TipTap 命令、快捷键、粘贴和尺寸拖拽提供事务检查。它只检查新增 marks、属性和替换片段，普通输入不扫描全文；只有格式不支持的能力才触发拦截，声明式增强操作在 MD 中正常执行。保留的转换回放路径仅在新 NB 的基准文档仍一致时重放。转换入口与事务回放共用 `documentComparison.sameDocument`，按节点/标记名称及属性比较语义，并归一图片和链接相对路径，不分配两份完整 JSON 文档树。回放使用步骤 JSON 和新编辑器 schema 重建步骤与 stored marks，一次提交且可独立撤销；不能复用旧 schema 的节点或标记实例。

外部 HTML 普通粘贴采用目标格式策略：MD 保留文字、链接、基础格式、列表、表格、图片与公式，忽略网页颜色、高亮、对齐和单元格底色；图注展开为紧随图片的普通段落，合并单元格按稀疏逻辑网格展开，原文字只保留一次。NB 继续保留可识别的丰富外观。`ExternalHtmlOptions.preservePresentation` 默认为 `true`，主编辑器的 MD 外部 HTML 入口传 `false`；小输入与 Worker 共用规范化实现，大输入无需先在主线程构建或二次解析整份剪贴板。这是外部导入策略，不表示 MD 无法保存声明式样式。内部结构化 MIME 与显式 Markdown 来源保持其结构，已登记的声明式能力不触发转换。Ctrl+Shift+V 始终走纯文本入口，不推断 Markdown/表格或读取 HTML 外观。

网页相对链接、锚点和图片共用 URL 解析策略：仅根据 CF_HTML `SourceURL`、调用方提供的 `sourceUrl` 或有效 HTTP(S) `<base>` 补齐地址，不借用本地编辑器/解析器的页面 URL。缺少来源时保留原相对路径；显式 Markdown 和内部 MIME 的本地路径不经过网页基址转换。URL allowlist 在主线程和 Worker 共用，解析不触发资源下载。

工具栏、选区菜单、内容块菜单和图片节点菜单使用相同命令入口。图片拖拽只预览尺寸，松开后提交一次可撤销修改。MD 与 NB 都支持可编辑声明式源码及 Ctrl+/ 切换；源码工具栏只针对源码选区提供操作，原始帧修复视图独立于普通源码。

对齐属性按节点 schema 的默认值判断：独立公式默认居中属于普通公式展示；非默认公式对齐及段落显式对齐属于 `declarative` 增强排版，在 MD 中也可直接保存。`documentCapabilities.test.ts` 与嵌套 HTML 的实际粘贴回归共同验证格式支持与导入策略边界。

## 偏好与关联提示

`settings.editor.pureMarkdown` 默认为 `false`，Rust 缺失字段也按 `false` 读取。打开该偏好会隐藏声明式增强编辑及 NB 新建入口，默认新建 Markdown；关闭时默认新建 NB。该偏好影响 UI 可见性，不改变现有文档格式或已有扩展内容的阅读能力。

只有 NB 存在有效 Markdown 关联时，工具栏显示“更新关联 Markdown”，直接复用现有保存服务。关联 Markdown 的外部变更存在冲突时，`LinkedMarkdownBanner` 订阅冲突状态并提供查看 Markdown 或保留 NB 后更新 Markdown 的选择；确认接受最新外部版本后才调用同一个保存服务。
