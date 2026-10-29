# 声明式编写

NoteBoard 的可编辑源码以 Markdown 为主体，用 `\name[参数]{内容}` 和 `::: name 参数` 补充精确样式、图片布局和作者说明。`.md` 与 `.nb` 使用同一正文语法；`.md` 保存扩展文本，`.nb` 的源码视图展示正文，磁盘保存仍经过原生格式适配层。AI 只需生成正文，无需生成 `.nb` 存储帧。Ctrl+/、短命令与 `/` 菜单继续作为互补的输入入口。

## 语法与模型边界

`src/features/declarative/registry.ts` 是命令、参数、别名和插入示例的目录。`syntax.ts` 在宿主 Markdown 的块与行内边界内读取扩展；代码、数学和地址保持各自语法。`grammar.ts` 提供 literal/raw 的显式模型承载，未知命令、未知块、参数错误和不完整内容保留可编辑原文，不以部分有效参数猜测渲染。`resolve.ts` 在文档范围统一处理 annotation 定义、前向引用和 explain 与前一个块的关联，拒绝重名、缺失和交互说明嵌套。

解析结果包含正文、诊断与源码位置，序列化同时返回源码和节点位置。`authoringSourceSession.ts` 适配 `.nb` 的可编辑源码与持久化帧，并用位置映射帮助切换模式后的选区恢复；`authoringInput.ts` 只负责识别当前输入范围、调用共享解析器并把模型插入编辑器。新语法的类型、错误恢复和引用含义归共享层负责，UI 适配层不另写一套解析规则。

当前简写覆盖 b/i/s/u/blur、颜色与文字底色、短说明与共享说明、单图/宫格/轮播、普通表格、折叠、五类醒目块、对齐和块底色。`pic` 采用行*列与按行顺序的图片项，`slide` 用一维图片项及静态列数；表格只用明确列宽与对齐参数。说明定义进入作者源码，当前轮播页等阅读状态独立保存。

可表达能力不足时，序列化器用 `::: native version=1` 包装经过 schema 校验的原生节点，保留未映射属性及复杂结构。该块是保真后备通道；AI 指南要求保留已有块，通常只生成公开的正文语法。合并单元格、复杂表头、行/单元格样式、行高与跨页控制等没有简写时，不能丢弃属性或假称普通 Markdown 能无损承载。

源码保存与通用 Markdown 导出分开。外部 Markdown 阅读器不保证呈现布局、颜色和说明；通用导出按能力映射降级，不能因合法链接、公式或扩展文本就强制改成 `.nb`。相关持久化与导出边界见 [原生文档](native-documents.md) 与 [文档导出](document-export.md)。

## 内置 AI 编写指南

`skills/noteboard-authoring/SKILL.md` 是可独立交给 AI 的语法指南，也是应用内展示、复制和下载的唯一正文。它只描述本地文本编写能力，不需要网络、API key 或额外权限，不安装到用户个人 Codex skills。

`src/features/authoring-guide/AuthoringGuide.tsx` 通过 Vite raw import 嵌入这份文件。欢迎页按钮打开 Radix Dialog，设置的应用分组直接展示同一个 `AuthoringGuideContent`；没有新增常驻面板或工具栏按钮。独立 CSS 只使用主题颜色、字号和已有按钮风格。

复制操作复用 `copyText`。保存操作复用 `exportBlobWithDialog`：Tauri 走系统另存为和现有 Rust 写盘封装，浏览器走 Blob 下载。取消保存不提示成功，失败显示具体原因，忙碌期间禁用重复操作。指南只读文本区允许直接选择全文。维护语法时同步检查 registry、SKILL 例子及解析回归，避免软件与对外编写约定分叉。

## 验证

`test/authoring-guide/authoringGuide.test.tsx` 通过 mock 文件出口覆盖同源全文复制、保存入口、取消和失败反馈，不写用户文件。Skill 使用 skill-creator 的 `quick_validate.py` 检查元数据与完整性；`skillExamples.test.ts` 提取指南里的 `noteboard` 示例，经过实际共享解析器检查零诊断、布局与说明模型，并验证精确行内样式与嵌套颜色。
