<div align="center">

<img src="logo.png" alt="NoteBoard" width="96" />

# NoteBoard

**Windows 本地笔记与图表编辑器**

[![正式版](https://img.shields.io/badge/1.0.2-正式版-blue)](https://github.com/ShallowDream724/NoteBoard/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/ShallowDream724/NoteBoard/releases/latest)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[下载安装](https://github.com/ShallowDream724/NoteBoard/releases/latest) · [更新说明](docs/releases/1.0.2.md) · [反馈问题](https://github.com/ShallowDream724/NoteBoard/issues)

</div>

NoteBoard 可以写笔记、整理表格、画流程图，也能打开代码和配置文件。文档直接保存在本地，不需要注册账号或先导入一个专用资料库。

喜欢 Markdown，可以继续用熟悉的语法；需要颜色、图片轮播、补充说明和更细的表格排版，可以使用 NB 原生文档。写完后导出 PDF，或交给 Word、LaTeX 等工具继续处理。

## 安装与试用

1. 在 [正式版发布页面](https://github.com/ShallowDream724/NoteBoard/releases/latest) 的 **Assets** 中下载 `NoteBoard_1.0.2_x64-setup.exe`。
2. 运行安装程序。需要 Windows 10 / 11 x64 和 WebView2；缺少 WebView2 时，安装程序会联网下载。
3. 打开应用，在主页点击 **浏览功能示例**。里面的文字、表格、图片和公式都可以直接编辑。

已有安装可以覆盖更新，也可在设置的“关于”中检查更新；当前限制见[下文](#当前限制)。GitHub 自动附带的 Source code 是源码，不是安装包。

## 文档与写作

- **可视化与源码切换**：直接编辑正文，也能查看和修改源文件。
- **标题与大纲**：折叠章节、从大纲跳转，拖动标题时带上整节内容。
- **选区工具栏**：选中文字就能加粗、加下划线、改颜色或高亮；段落左侧菜单负责整块操作。
- **列表与缩进**：有序列表、无序列表、任务清单，以及正文和标题缩进。
- **提示块**：选择图标、标题、文字色、边框和背景。输入 `[!` 或 `【！` 可调出类型补全，原有 Note、Tip、Important 等写法也能继续用。
- **折叠与说明**：把较长的补充材料收进折叠块，或给文字、图片、表格添加可点开的说明。

喜欢用鼠标时，按 Enter 新起一个空段落，将鼠标移到这一行左侧，点击出现的 **+** 插入表格、图片、公式或折叠块。已有内容左侧的六点把手用于拖动整块。

喜欢用键盘时，在空段落输入 **/** 打开命令菜单，继续输入名称即可搜索。例如 `/fold` 插入折叠块，`/table` 插入表格，`/note` 插入提示块。用 ↑ / ↓ 选择，Enter 确认，→ 展开分类，Esc 收起；不常用的标题、列表和清除格式也能在菜单中找到。

## NB 与 Markdown 怎么选

| 文件 | 适合的用途 |
| --- | --- |
| `.md` / `.markdown` | 需要与其他 Markdown 编辑器交换的笔记、项目文档。 |
| `.nb` / `.nbdoc` | 需要完整保留配色、布局、图片组合和说明的文档。两个扩展名使用同一种格式。 |

Markdown 使用增强排版时，会提示转换为 NB。转换后的 NB 就放在原文件旁边；保留关联时，文件树中以 NB 为主体，展开能看到原 MD，不会额外创建一层文件夹。

保存关联 NB 会同时更新 MD。能明确对应的 MD 文字修改可以合回 NB，保留原有颜色和高亮；双方改了同一段时，会提示冲突，等待处理。**自动回传有范围限制**：折叠、说明等降级后改变了块结构，当前无法自动回传。

NB 是可读的文本格式。本地图片使用外部文件引用，复制文档到别处时，要一起带上图片目录。使用 Wolfram Notebook 的电脑可选 `.nbdoc`，避免与 `.nb` 扩展名混淆。

## 表格与图片

### 文档表格

选择单元格、整行或整列后，可以设置底色、对齐、合并或拆分。行高和列宽支持拖动调整，也可以均分；表头、标准表和三线表适合不同的资料整理与排版需求。

表格自身的左、中、右位置与单元格文字对齐分开设置。表注放在表格下方，整表说明跟随表格移动。

阅读时，长表连续向下展开，宽表保留可读列宽，超宽部分通过页面横向滚动查看。点击表格左侧把手旁的块菜单，可在“阅读视图”中改为“滚动块”，把横向、纵向滚动限制在该表格内；选择“自然展开”即可恢复。右侧大纲覆盖在内容上方，展开或收起都不会挤压表格与公式。

### 图片与图集

单张图片、四宫格、六宫格、九宫格和轮播都能放进文档。支持图注、组合尺寸和图片查看；轮播固定居中，宫格可调整在正文中的位置。

导出 PDF 时，轮播会展开全部图片，折叠块也会展开。分享出去的人不需要点开文档里的每个控件才能读完整内容。

## 公式与图示

- **数学公式**：支持行内和独立公式、矩阵，以及 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`。中文输入时也可用 `￥…￥` 或 `¥…¥`，独立一行输入 `￥￥` 后按 Enter 新建公式块；`￥ 100` 等金额仍作为正文。行内源码随输入自然展开，末尾按右方向键或点击外部完成编辑。写错时保留源码，便于继续修改。
- **公式阅读视图**：独立公式默认保持源码规定的换行，不自动折行。左侧块菜单可选择“自动换行”或“滚动块”。这些阅读选择只在当前编辑视图中生效，不改文件、不占用撤销步骤，也不改变 PDF 的分页设置。
- **Mermaid**：用文本写流程图，放大查看细节；查看时的缩放不改变打印比例。
- **PlantUML 与 Infographic**：编辑图表脚本并预览，也可放进笔记。图表支持导出 SVG / PNG。
- **自由画板**：用 Excalidraw 画草图、标注和梳理思路。
- **思维导图**：在脑图与层级大纲之间切换，支持节点备注和图片。
- **Draw.io**：编辑架构图和流程图。

PlantUML 当前使用在线渲染服务，图表源码会提交给该服务；Draw.io 编辑器从 diagrams.net 加载。这两项需要网络。普通笔记、文档表格和 Mermaid 不依赖这两个在线服务。

## 多维表格与其他文件

用 `.bitable` / `.table` 整理项目、阅读记录或资料清单。支持表格与看板视图、排序、分组，以及文本、数字、单选、多选、日期时间、复选框等字段。

同一个窗口还可以打开文本、JSON、YAML、SQL 等代码和配置文件，进行查找替换、语法高亮和格式化；图片与 PDF 可以直接预览。多标签页、多窗口和本地文件树适合在几份资料之间来回切换。

## 导出与打印

| 格式 | 可以得到什么 | 额外依赖 |
| --- | --- | --- |
| PDF | 调整纸张、页边距、字号和页码后预览；处理超宽表格与公式。 | WebView2 |
| HTML | 可单独打开的网页，保留折叠、轮播和模糊揭示等阅读交互。 | 无需 Pandoc |
| Word / LaTeX | 继续排版的文档，包含支持的表格、图片、公式与说明脚注。 | Pandoc 3.0+；编译 LaTeX 另需 TeX 环境 |
| Markdown | 便于交换的文本，去掉 NB 专属表现，保留正文及可表达的结构。 | 无需 Pandoc |

PDF 导出后会在新标签页打开，不改变原来的文件树目录。字体可使用本机已安装字体，也可在设置里下载可选字体包；打印使用配置的文档字体，缺少的字形仍会回退。

导出使用打开导出窗口时的最新内容，包含尚未保存的修改；不需要先保存，也不会替你保存原文件。PDF 的纸张、方向、边距、字号、行距和页码配置会沿用上次设置。HTML 可在应用内预览，也可用默认浏览器打开、定位文件或另存副本，便于检查和分享。

## 按自己的习惯调整

提供晨光、琥珀、墨夜三种主题，也可以跟随系统。界面、正文、代码和文件树的字体可分别设置；字号、行距、正文宽度和选区工具栏位置都能调整。

快捷键支持搜索、修改、禁用和恢复默认。几个常用的默认组合：

| 操作 | 快捷键 |
| --- | --- |
| 保存 | `Ctrl+S` |
| 打开文件或文件夹 | `Ctrl+O` |
| 查找 | `Ctrl+F` |
| PDF 排版预览 | `Ctrl+P` |
| 一级至六级标题 | `Ctrl+1` … `Ctrl+6` |
| 恢复正文 | `Ctrl+0` |

## 当前限制

- 本次仅提供 **Windows x64** 安装包，未发布 macOS、Linux 或 ARM64 版本。
- 关联 MD 的自动回传适用于能逐块对应的文字修改。包含折叠、说明等降级结构时，MD 回改会进入冲突保护，需要手动处理。
- 图片不是打包在 NB 里的附件，移动或分享源文档时需携带外部图片。
- Word、LaTeX 及其他 Markdown 阅读器的显示结果受各自支持的语法、字体和排版方式影响。
- 没有内置账号同步和多人实时协作。正式版检查正式更新；支持预发布通道的 RC 安装也会检测后续正式版，可通过“下载并安装”升级。

## 反馈与开发

遇到问题请提交 [Issue](https://github.com/ShallowDream724/NoteBoard/issues)，尽量附上版本、复现步骤、预期与实际结果，以及一份不含私人内容的小样例。涉及排版时，截图通常比描述更直观。

本地构建需要 Node.js 22、pnpm、Rust stable、MSVC C++ 构建工具和 Windows SDK。

```bash
git clone https://github.com/ShallowDream724/NoteBoard.git
cd NoteBoard
pnpm install --frozen-lockfile
pnpm tauri dev
```

生成 Windows 安装包：

```bash
pnpm tauri build
```

项目使用 Tauri、React、TypeScript、TipTap 和 CodeMirror。格式与接口说明见 [原生文档](docs/architecture/native-documents.md)、[NB 编写规范](docs/architecture/native-authoring.md) 和 [导出设计](docs/architecture/document-export.md)。

## 来源与许可

本项目基于 [CrazyFigure/NoteBoard](https://github.com/CrazyFigure/NoteBoard) 继续开发，采用 [GPL-3.0-only](LICENSE) 许可。感谢原项目及 Excalidraw、Mermaid、KaTeX、diagrams.net 等开源项目。

本仓库的安装包与更新发布在 [ShallowDream724/NoteBoard Releases](https://github.com/ShallowDream724/NoteBoard/releases)。
