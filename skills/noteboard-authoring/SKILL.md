---
name: noteboard-authoring
description: Generate or edit NoteBoard documents using Markdown and NoteBoard declarative authoring syntax, including styled text, image layouts and attached explanations.
---

# NoteBoard 编写

生成供 NoteBoard 编辑的文本时使用本指南。正文以 Markdown 为主；仅在需要布局、精确样式范围或说明时使用扩展。输出完整文档源码，除非用户要求说明，否则不要把整篇包在代码围栏内。`.md` 与 `.nb` 的编辑源码均可使用此正文；保持用户选择的文件格式，`.nb` 的磁盘封装由应用保存，不要生成内部存储帧。

标准 Markdown 继续用于标题、段落、列表、任务列表、链接、图片、表格、引用、代码和数学。人可以用短命令或 `/` 菜单插入内容，用 Ctrl+/ 在源码与预览之间切换。

扩展语法的参数用 `[]`，内容用 `{}`；块使用独立行的 `:::` 围栏。不要生成任意 HTML、CSS、脚本或未列出的命令。未知、错误或未闭合的扩展保留原文，不应依赖错误写法产生效果。

## 行内语法

命令名与第一个括号相邻；无参数时省略 `[]`。内容组必须在同一段落内闭合，不能包含空白行或块。组内可用 Markdown 行内内容和嵌套显示效果；不要让强调或链接从组外跨进组内配对。

| 写法 | 效果 |
| --- | --- |
| `\b{内容}`、`\i{内容}`、`\s{内容}` | 加粗、斜体、删除线的精确边界 |
| `\u{内容}` | 下划线 |
| `\blur{内容}` | 模糊隐藏 |
| `\color[#2563eb]{内容}` | 文字颜色 |
| `\bg[rgb(254, 240, 138)]{内容}` | 文字底色 |
| `\note{锚点}{短说明}` | 附在文字上的短说明 |
| `\note[ref=term]{锚点}` | 引用命名说明 |

普通强调优先用 Markdown。中文标点使 Markdown 分隔符无法可靠闭合时，用 `\b{添加与整理：}空行` 等明确边界。下划线只用 `\u{内容}`；`C++`、`a++`、`++说明++` 不表示下划线。

颜色接受 HEX `#RGB`、`#RRGGBB`、`#RGBA`、`#RRGGBBAA`（透明度在最后），以及 `rgb(37, 99, 235)`、`rgba(37, 99, 235, 0.5)`。RGB 使用三个 0–255 整数，透明度 0–1。可用常见色名 black、white、gray、grey、red、green、blue、yellow、orange、purple、teal；生成时优先 HEX 或 RGB。

不同效果可以嵌套：`\blur{\bg[#fef08a]{\color[#9a3412]{答案}}}`。相同效果的内层覆盖外层，内容组结束后恢复外层。代码、数学和链接地址内不执行命令。字面反斜杠命令写成 `\\blur{答案}`；内容中的字面花括号保持配平，孤立括号写 `\{` 或 `\}`。

## 块与参数

起始行写 `::: 名称 参数`，正文后用独立一行 `:::` 关闭。参数按空格分开；带空格的标题用 ASCII 双引号。生成时写 `name=value`，不要把分号当分隔符。同层可以嵌套，含内层块时建议外层用四个冒号并用相同长度结束。

| 块 | 参数及含义 |
| --- | --- |
| `pic` | `grid=行*列`、`align=left/center/right`、`width=50%`；省略 grid 为单图 |
| `slide` | `align`、`width`、`print-cols=2`；按顺序轮播，静态展开默认两列 |
| `table` | `size=行*列`、`align`、`widths=[130,160]`；首行表头计入行数 |
| `fold` | `title="推导过程"` 必填非空，`open=true` 可选，默认收起 |
| `note`、`tip`、`important`、`warning`、`caution` | `title`、`icon`、`bg`、`border`；省略标题用默认标题，`title=""` 隐藏标题 |
| `left`、`center`、`right` | 无参数，设置直接子块的对齐默认值 |
| `bg` | `bg=#eff6ff`，设置块底色 |
| `annotation` | `id=term`，命名说明定义 |
| `explain` | 可选 `ref=term`，给紧邻前一个完整块附说明 |

短写与命名写法等价：`::: pic 2*3 center 50%`、`::: fold "推导过程" open`、`::: annotation term`、`::: bg #eff6ff`。生成时尺寸统一用 `行*列`，对齐统一用 `left/center/right`。不要重复设置同一字段或输出冲突参数。width 大于 0 且不超过 100%；table 的 widths 是正数像素列表，数量等于列数。

图片、宫格、轮播的 align 移动整个对象；table 的 align 移动整张表，单元格文字对齐仍由 Markdown 表格分隔行控制。不要生成任意 CSS 字段、表达式、变量或循环。

```noteboard
:::: fold "学习要点" open
::: tip "先记住这个" bg=#f0fdf4 border=#bbf7d0
普通 **Markdown** 与 \color[rgb(37, 99, 235)]{彩色文字} 可以并用。
:::

::: right
这一段靠右。
:::
::::

::: table center widths=[130,160]
| 项目 | 结论 |
| :--- | ---: |
| 速度 | 42 |

测量结果。
:::
```

## 图片布局

单图块放一张标准 Markdown 图片，之后最多一段图注。宫格和轮播用顶层列表项表示图片项，图注缩进至少两个空格。单独的 `-` 表示空位。宫格按源码顺序逐行从左到右排列；少于容量留空，超过容量是错误。宫格最多 32 列、1024 格；slide 不接受二维尺寸，静态展开最多 32 列。

```noteboard
::: pic center 50%
![暮色](images/evening.png)

傍晚的天空。
:::

::: pic 2*2 center
- ![春](images/spring.png)
  春季记录。
-
- ![秋](images/autumn.png)
  秋季记录。
- ![冬](images/winter.png)
:::

::: slide right print-cols=2
- ![第一步](images/step-1.png)
  准备材料。
- ![第二步](images/step-2.png)
  开始操作。
:::
```

只使用用户提供或真实可用的图片路径与 URL；示例路径需要替换。不要根据图注或文件名数字重新排序，也不要为填满布局虚构图片。

## 说明与引用

短说明用 `\note{词}{解释}`；需要段落、列表或多处共用时，用 annotation。名称为 1–128 个 ASCII 字母、数字、下划线或连字符，整篇唯一，区分大小写，允许先引用再定义。定义不作为正文卡片显示。

note 锚点只能含文字、公式和显示效果；不要把链接、图片或另一个 note 放入锚点，也不要把 note 放入链接。说明正文可有普通链接，但不能再创建说明或 annotation。需要链接和说明时并列放置两个入口。

explain 绑定同一父容器内紧邻的前一个完整块，空白行不影响绑定；不能越过正文或 annotation 定义寻找目标。每个目标只附一份 explain。直接写说明正文，或写 `::: explain ref=term` 并留空块体，二者互斥。

```noteboard
这里的\note{梯度}{函数在当前位置变化最快的方向。}是短说明。

参见\note[ref=method]{实验方法}，另一处也可引用\note[ref=method]{同一方法}。

::: annotation method
先记录环境，再测量结果。

- 固定输入规模。
- 记录耗时与误差。
:::

::: warning "温度偏高"
本次读数需要复测。
:::
::: explain
传感器尚未达到稳定温度，等待后重新测量。
:::

这一段也附有共享说明。
::: explain ref=method
:::
```

编辑源码时，复制定义需分配新名称并同步修改副本引用；仅复制引用可继续共享原定义。不要产生重名定义、缺失引用或递归说明。

## 输出检查

检查每个命令的内容组数量、配对括号和块围栏；检查引用都有唯一目标。将普通加号、花括号、代码、URL 和 LaTeX 保持原意。无法用已列语法表达的原生功能应明确保留或说明限制，不要捏造命令。合并单元格、复杂表头、单元格或行样式、行高和跨页表格控制尚无本指南简写。编辑已有源码时，完整保留应用生成的 `::: native version=1` 原生保留块及 `\native[version=1]{…}` 行内保留片段；后者内容是 base64url 编码的 JSON。不要自行编造或改写这些内部载荷。

本指南的扩展是 NoteBoard 语法；通用 Markdown 阅读器不保证呈现布局、颜色和说明。保存源码与导出通用 Markdown 分开处理，导出时可能降级扩展效果。
