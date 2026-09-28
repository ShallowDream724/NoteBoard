# 编写 NoteBoard 原生文档

`.nb` 与 `.nbdoc` 是同一种 UTF-8 文本文档。文件使用独立记录帧，每条记录的载荷是单行语义 JSON，可以手写、由脚本生成，或由 AI 根据本规范生成。无需二进制编码、DOM 路径、内部对象 ID 或像素坐标。字段顺序不重要，默认属性可以省略。

## 最小文档

```noteboard
#!noteboard 1
@block {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"观察记录"}]}
@block {"type":"paragraph","content":[{"type":"text","text":"正文可以直接写在这里。"}]}
```

第一行必须为 `#!noteboard 1`。`@block ` 开始一个顶层块，也是错误恢复边界。节点使用 `type`、可选 `attrs`、子节点数组 `content`、行内 `marks` 和文本叶节点 `text`。空段落写 `@block {"type":"paragraph"}`，不要生成空字符串文本节点。粗体等效果通过 `marks` 表达，不在 `text` 里放 Markdown 语法。公开模型独立于编辑器类型，不保存任意 HTML 或 CSS。

每条记录必须在一个物理行内；代码、多行公式和正文的换行使用 JSON 标准转义 `\n`，引号写 `\"`，反斜线写 `\\`。不要把一个 JSON 对象跨行缩进，也不要包裹整篇 `document` 对象。空白行可用于分隔记录。

表格、列表、图片组合和说明集合使用容器骨架 `@block` 与逐行/项 `@child`，`@child` 属于最近的容器。可分片容器为 `table`、`bulletList`、`orderedList`、`taskList`、`imageCollection`、`annotationStore`。大表必须每行一条 `@child`，避免把一万行塞入一个 JSON 记录；子节点内部保留完整内容树。

```noteboard
#!noteboard 1
@block {"type":"table"}
@child {"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"项目"}]}]}]}
@child {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"观察"}]}]}]}
@block {"type":"paragraph","content":[{"type":"text","text":"表格后的正文。"}]}
```

可选的 `@meta {…}` 只出现在文档头后、首个正文块前。Markdown 关联为 `{"markdown":{"path":"./note.md","baselineHash":"最后一致版本摘要","projectionVersion":1}}`。关联基准由保存服务维护，手写文档可省略。未来元数据按命名空间扩展：名字由字母开头，后续只用字母、数字、点或连字符；每个命名空间的值必须是 JSON 对象，未知命名空间完整保留。

NB 源码模式直接编辑这些记录。坏记录显示可定位的局部错误块，原文保留；后面的有效 `@block` 仍可显示。未知节点、样式和属性也保留原文，修复前导出会明确降级或报错。不要把错误块当成可丢弃的内容。损坏文档头无法保证原先的结构，应用只恢复可可靠识别的边界；内部旧整篇 JSON 不作为另一种受支持格式。

## 常用内容

| type | 属性 / 子内容 |
| --- | --- |
| paragraph | 行内内容；可选 `textAlign: left/center/right`、`indent: 0..8` |
| heading | `level: 1..6`；行内内容 |
| hardBreak | 行内换行，无子内容 |
| bulletList / orderedList | listItem 子节点；orderedList 可有 `start` |
| listItem | 一个 paragraph 后跟其他块，可含子列表 |
| taskList / taskItem | taskItem 有布尔 `checked`，正文同列表项 |
| blockquote | 普通块数组 |
| codeBlock | `language` 可选；仅文本内容 |
| image | `src` 必填；可选 `alt`、`title`、`width`（如 `100%`）、`align`、`caption` |
| mathInline / mathBlock | `latex`；`delimiter` 默认分别 `$` / `$$`，无子内容 |
| table / tableRow | 表格包含行，行包含 tableCell / tableHeader；table 可有 `tableAlign: left/center/right` 和 `caption` |
| tableCell / tableHeader | 普通块数组；`colspan`、`rowspan` 默认 1，`colwidth` 是按逻辑列的像素宽度数组；可选 `background`、`textAlign`、`verticalAlign` |
| tableRow | 可选 `height` 为最小行高，不会裁切内容 |
| githubAlert | 提示块；`kind: note/tip/important/warning/caution`，普通块数组；可选标题、图标及颜色见下文 |
| mermaidBlock / plantumlBlock / infographicBlock | `code` 保存完整源码 |
| horizontalRule | 分隔线，无子内容 |

行内 marks：`bold`、`italic`、`underline`、`strike`、`code` 不需要属性；`link` 使用 `href`，`textColor` 与 `highlight` 使用六位十六进制 `color`。例如：

```json
{"type":"text","text":"重点","marks":[{"type":"textColor","attrs":{"color":"#dc2626"}},{"type":"highlight","attrs":{"color":"#fef08a"}}]}
```

颜色放在对应文字上，修改文字时不需要更新字符偏移。不要生成正文内容的重复快照。标准/三线表由顶层 `documentPresentation` 节点的 `tableStyle: standard/three-line` 控制，不必给每张表重复配置。

## 提示块

提示块统一使用 `githubAlert`，不另设平行节点。`kind` 默认 `note`，沿用五种 GFM 预设。`title` 省略或 `null` 显示预设标题，`""` 隐藏标题，非空字符串为自定义标题（单行、最多 500 字符）。正文始终是 `content` 中的完整块数组，不根据换行猜测标题。

```noteboard
@block {"type":"githubAlert","attrs":{"kind":"tip","title":"","icon":"🌱","borderColor":"#bbf7d0","backgroundColor":"#f0fdf4"},"content":[{"type":"paragraph","content":[{"type":"text","text":"给每一个灵感留一点空间。"}]},{"type":"paragraph","content":[{"type":"text","text":"这里可以继续写第二段。"}]}]}
```

`icon` 省略或 `null` 跟随预设 SVG，可指定五种 `kind` 值或 `success`（圆圈对勾）选择 SVG，也可写一个 emoji 字形（支持肤色、旗帜及组合 emoji，最多 32 UTF-16 单元）。`success` 只改变图标，保留原有类型、标题和配色；NB 与 HTML/PDF 保留图标，Markdown 导出沿用原有 GFM 类型。`textColor`、`borderColor`、`backgroundColor` 为可选的 `#RRGGBB`，`null` 恢复主题默认。显式背景未指定文字色时，视图按亮度自动选择文字色；这一显示计算不增加存储字段。行内 `textColor` 优先于提示块文字色。

通用插入默认无标题、有图标。GFM 预设输入保留预设标题；空段落直接输入 `[!]`、`【！】`（括号和感叹号可中英文混用）显示补全，也可输入完整 `[!TIP]` 后回车。Markdown 导入仍使用 `> [!TIP]`。自定义标题、图标与颜色属于 NB 能力；基本五种预设可直接保存在 MD。HTML/PDF 保留外观；通用 Markdown 保留 GFM 标记、自定义标题、语义 emoji 和全部正文，降级颜色与 SVG 图标；Pandoc 保留标题、emoji 和正文。

## 图注与表注

单张 `image` 和 `table` 的 `attrs.caption` 保留兼容的普通文字，省略或 `null` 表示无注。最多 10,000 个 UTF-16 单元，允许使用 JSON `\n` 换行，禁止 NUL 字符。可选 `captionContent` 保存同一段注释的行内 JSON 数组，仅允许 text/hardBreak，以及 bold、italic、underline、strike、code、link、textColor、highlight 标记；旧文档仅有 caption 时仍按普通文字显示。编辑器同步维护两者。它跟随所属块移动和撤销，与弹出的 `annotationId` 补充说明独立。表注与表格同宽、图注与图片同宽，左右位置跟随所属块。

```noteboard
@block {"type":"image","attrs":{"src":"./img/result.png","alt":"实验曲线","caption":"图 1　不同条件下的结果"}}
@block {"type":"table","attrs":{"tableAlign":"center","caption":"表 1　样本统计\n单位：毫克"}}
@child {"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"样本"}]}]}]}
```

图注与表注属于 NB 能力。HTML/PDF 保留行内样式与链接，Pandoc 使用 Figure/Table 的 Caption，通用 Markdown 在图或表后输出保留格式的段落。图片组合继续使用槽中的图注 paragraph。

单图图注独立于替代文本 `alt` 和链接提示 `title`。鼠标进入图片或表格时显示下方添加入口，与宫格和轮播共用紧凑按钮及蓝色悬停、键盘焦点反馈。空注入口保留 6px 主体间距及 24px 点击区域，参与布局以避免覆盖相邻内容，不创建空段落，打印时隐藏；图、表块菜单也提供添加/编辑入口。已有图注可点击编辑，选中文字显示共用浮动文字工具栏，可修改文字颜色、高亮等行内格式。编辑即时进入文档和自动保存，Enter 换行，Escape 或移出编辑区域结束编辑，清空文字删除图注；Ctrl+Z/Y 使用正文的撤销历史。仅活动图注按需加载并挂载轻量编辑器，结束后释放，静态图注不各自持有编辑器实例。`FigureCaptionTransition` 在加载期间保留原图注或添加入口及其布局，编辑器内容就绪后才切换显示并聚焦；等待时移开焦点、点击别处、按 Escape/Tab 或离开窗口会取消请求，加载失败保留原内容并允许重试。可编辑入口在 pointerdown/mousedown 阶段保留正文选区，首次 click 直接进入图注。表注的静态入口覆盖整个 caption 行盒（含文字上方间距），不只覆盖文字 span；点击不继续冒泡到表格或正文，避免浏览器先将光标放入首格。补充说明按钮与已打开的图注编辑器保持各自的点击处理。

## 图片组合

```noteboard
@block {"type":"imageCollection","attrs":{"layout":"grid","columns":2}}
@child {"type":"imageSlot","content":[{"type":"image","attrs":{"src":"./img/observation.jpg","alt":"观察照片"}},{"type":"paragraph","content":[{"type":"text","text":"第一天的观察"}]}]}
@child {"type":"imageSlot"}
@child {"type":"imageSlot"}
@child {"type":"imageSlot"}
```

`layout` 为 `grid` 或 `carousel`，`columns` 为 2 或 3；四宫格为 4 槽/2 列，六宫格为 6 槽/3 列，九宫格为 9 槽/3 列。每槽允许空白，或一张 image 后接一个可选图注 paragraph。不要用表格模拟图片模板。轮播也使用相同子结构，打印将全部图片排入网格，不需要另存打印副本。

集合可加 `width: "75%"` 与 `align: "left"`。宽度是正文区域的百分比（整数 1–100%，默认 `100%`），统一缩放整组，无需改写每个 image。宫格对齐为 `left`、`center`、`right`，默认居中；轮播始终居中。块菜单提供 100%、75%、50%、25% 与宫格对齐。NB、HTML 和 PDF 保留集合宽度；Markdown/Pandoc 的静态网格以内容保真为准，不承诺相同版面。点击宫格/轮播的图片可打开全屏查看，滚动轮播不修改文档。

图片保留正常相对路径或 HTTP(S) 地址。相对路径相对于文档所在目录；移动文件时需同时携带图片目录。不建议把大图的 Base64 嵌入文档：外部资源可以独立加载与回收，正文历史不必反复保存二进制数据。

应用插入图片时使用外部文件引用；未命名文档先使用应用恢复目录中的图片，首次保存再发布到目标图片目录。输入文件中的 data 图片仍可显示和导出，正常保存时会提取为外部图片，不需要 AI 把图片字节重复写进多个节点。详情见[图片资源保存](markdown-assets-and-callouts.md#图片正文与资源保存)。

## 折叠与模糊

```noteboard
@block {"type":"disclosure","attrs":{"title":"推导过程","open":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"即使折叠，也完整保存这段内容。"}]}]}
```

折叠块至少有一个普通块；空正文使用空 paragraph。`open` 为初始阅读状态。独立折叠块与标题章节折叠不同，前者有明确的容器边界。

文字使用 `{ "type": "conceal" }` mark 表示模糊；支持的内容块可用 `attrs.concealed: true`。模糊是可揭示的显示效果，普通导出完整显示正文。打印/导出无需作者手动去掉样式。

## 补充说明

说明正文只保存一次，锚点引用容易手写的字符串 ID，例如 `method-note`。不要使用全文字符偏移。顶层 `annotationStore` 包含各 `annotationBody`；应用将集合排列在正文之前，避免章节移动带走其他说明。读取时允许集合出现在任意顶层位置，但不能重复或嵌套。

```noteboard
#!noteboard 1
@block {"type":"annotationStore"}
@child {"type":"annotationBody","attrs":{"id":"method-note"},"content":[{"type":"paragraph","content":[{"type":"text","text":"这部分可以包含多段文字、列表和图片。"}]}]}
@block {"type":"paragraph","content":[{"type":"text","text":"观察方法","marks":[{"type":"annotationReference","attrs":{"id":"method-note"}}]}]}
```

为整张图片、公式或其他支持的块添加说明时，在该块 `attrs` 中写 `annotationId`。ID 必须非空、不超过 128 字符，正文与引用一一可解析；多个锚点可以引用同一说明。不允许缺失正文、重复 ID 或无锚点说明。说明正文内部不再嵌套补充说明。浮窗位置、大小和固定状态无需写入文件，不影响 AI 生成的文档布局。

## 生成优雅文档

- 先组织标题、正文、图注和说明，再选外观；不要把每句话都变成提示块或高亮。
- 统一使用语义标题层级。普通解释用正文，长推导用折叠块，旁注用补充说明，横向比较的图片用拼图。
- 图注保持简洁，图片使用原始比例；先选两列，确有必要比较三项时再用三列。
- 表格用真正的表头和单元格；合并应表达关系。避免用固定行高裁内容，行高本来就是最小值。
- 可以导出干净 Markdown，但图片布局、折叠和浮窗等交互会降级；所有正文、图片及说明内容仍保留。原生文件是完整可编辑的交付物。

该规范和 `examples/rich-document.nb` 是后续生成技能的依据。应用不对预发布历史文件添加迁移层；未来正式格式版本变化应单独评估。
