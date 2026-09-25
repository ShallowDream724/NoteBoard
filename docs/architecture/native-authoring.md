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
| image | `src` 必填；可选 `alt`、`title`、`width`（如 `100%`）、`align` |
| mathInline / mathBlock | `latex`；`delimiter` 默认分别 `$` / `$$`，无子内容 |
| table / tableRow | 表格包含行，行包含 tableCell / tableHeader |
| tableCell / tableHeader | 普通块数组；`colspan`、`rowspan` 默认 1，`colwidth` 是按逻辑列的像素宽度数组；可选 `background`、`textAlign`、`verticalAlign` |
| tableRow | 可选 `height` 为最小行高，不会裁切内容 |
| githubAlert | `kind: note/tip/important/warning/caution`，普通块数组 |
| mermaidBlock / plantumlBlock / infographicBlock | `code` 保存完整源码 |
| horizontalRule | 分隔线，无子内容 |

行内 marks：`bold`、`italic`、`underline`、`strike`、`code` 不需要属性；`link` 使用 `href`，`textColor` 与 `highlight` 使用六位十六进制 `color`。例如：

```json
{"type":"text","text":"重点","marks":[{"type":"textColor","attrs":{"color":"#dc2626"}},{"type":"highlight","attrs":{"color":"#fef08a"}}]}
```

颜色放在对应文字上，修改文字时不需要更新字符偏移。不要生成正文内容的重复快照。标准/三线表由顶层 `documentPresentation` 节点的 `tableStyle: standard/three-line` 控制，不必给每张表重复配置。

## 图片组合

```noteboard
@block {"type":"imageCollection","attrs":{"layout":"grid","columns":2}}
@child {"type":"imageSlot","content":[{"type":"image","attrs":{"src":"./img/observation.jpg","alt":"观察照片"}},{"type":"paragraph","content":[{"type":"text","text":"第一天的观察"}]}]}
@child {"type":"imageSlot"}
@child {"type":"imageSlot"}
@child {"type":"imageSlot"}
```

`layout` 为 `grid` 或 `carousel`，`columns` 为 2 或 3；四宫格为 4 槽/2 列，六宫格为 6 槽/3 列，九宫格为 9 槽/3 列。每槽允许空白，或一张 image 后接一个可选图注 paragraph。不要用表格模拟图片模板。轮播也使用相同子结构，打印将全部图片排入网格，不需要另存打印副本。

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
