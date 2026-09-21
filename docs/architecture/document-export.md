# 文档导出与编辑定位

## 入口与边界

标题栏的导出按钮、Ctrl+E 和 Ctrl+P 打开同一个导出预览。Ctrl+P 当前进入 PDF 排版预览，不触发浏览器页面打印；Ctrl+E 不再被 TipTap 行内代码快捷键占用。入口只加载轻量状态，首次打开才加载转换器、PDF.js 和样式。

`EditorCapabilities.flush('export')` 捕获包含未保存修改的快照，不保存原文档。`markdownDocument.ts` 使用编辑器同一套 Markdown 扩展和 schema；转换器不自己再猜测公式定界符。关闭导出会中止后续公式排版工作。

## PDF

- `renderDocument`：输出独立只读 HTML，保留公式、提示块 SVG、代码着色、图片、表格与标记，排除编辑控件。图片路径与编辑器共用 `core/documentPath.ts`。
- `layout`：只修改导出副本。小范围缩放以最小可见文字字号为界，复杂分式/矩阵不做盲目 TeX 字符切分。KaTeX 可断行的外层表达式允许换行，已有 aligned 等环境原样保留。不可安全装入一页的对象会提示并阻止保存，避免静默裁切。
- 表格先缩小或单元格换行；可逐表选择“分栏续表”，重复首列。合并单元格暂不支持分栏续表。长表格生成真正的 thead，跨页重复表头；特别高的行允许跨页。不会自动将页面改成横向。
- `renderEntry`：独立的 export.html 入口，不加载 App、编辑器会话或文件监听。等待字体与图片完成后进行纸张布局。
- Rust `export`：每个任务持有临时目录、完成通道和隐藏窗口；Windows WebView2 PrintToPdf 写入 PDF 文件，生成后销毁窗口。PDF 文件仅保留到预览替换或关闭；窗口状态插件不记录排版窗口。
- `usePdfJob`：合并 500 ms 内连续参数修改，取消过期任务；保持上一份完整预览直到新结果可用。更新期间不可导出旧文件。
- `PdfPreview`：展示真实 PDF，按可见页面加一页余量创建画布，替换文档时销毁 PDF.js 加载任务及 worker，离屏页面清理渲染资源。保存直接复制当前预览的 PDF，避免另一次排版造成差异。

默认 A4、12 mm 边距、10.5 pt 正文、1.4 行距；字号、最小字号、纸张方向及各对象排版方式均可调。当前页码选项使用 WebView2 原生页眉页脚；它不是自定义页脚模板。

Mermaid、PlantUML、Infographic 尚未接入文档 PDF 的图形输出，保留源码并在预览提示，不能将空图块伪装成成功导出。超高、无法合法断行的公式仍需用户编辑源码，或选择横向纸张；不承诺自动排好任意 TeX。

## Pandoc

本机 PATH 自动发现或“设置 → 导出”指定程序；缺失时提供官方下载入口，不打包或自动安装 Pandoc。`pandocDocument.ts` 把 Markdown schema 转成 Pandoc JSON AST，公式传入 Math 节点，因此不再经历第二次美元号解析。Rust 读取当前 Pandoc 的 AST 版本后转换为 DOCX、HTML、LaTeX，并回传转换警告。

DOCX 的最终分页由 Word/WPS 决定；PDF 的逐项缩放与分页选项不映射为 DOCX 的固定页面位置。LaTeX 保留公式源码，后续编译需要用户本机 TeX 环境。HTML 使用 Pandoc 的 MathML 输出。外部格式目前不承诺与 PDF 的提示块颜色及所有排版完全相同。

## 模式切换与高亮

`sourcePosition.ts` 仅在切换瞬间，使用当前 Markdown lexer 的 raw 范围与 ProseMirror 文本流对应两个选区端点；重复文本顺序匹配，不在 store/history 保存整篇 source map，不创建第二个编辑器。代码、转义、实体、列表、引用与公式均参与映射；公式原子及不可编辑语法映射到邻近节点边界，扩展语法不匹配时使用有界近邻恢复。源码与可视化目标滚动到映射选区。

`codeHighlighting.ts` 共用按需加载的 Lowlight 引擎；编辑区由 `CodeHighlight` 提供 ProseMirror decorations，导出使用相同 tokens 生成只读 HTML。未知语言与超过 200,000 字符的单个代码块保留纯文本。旧的未注册、直接写可编辑 DOM 的 viewportHighlight 已删除。

## 针对性验证

前端回归覆盖模式切换的重复文本、嵌套引用/列表、转义、公式、代码；公式输入生命周期；离屏释放；代码文本完整性；导出提示块与表头。原生探针 `src-tauri/examples/pdf_smoke.rs` 可读取 PdfPayload JSON 并输出实际 PDF，不加载用户会话。开发探针需要 Vite 开在配置端口；离线运行先构建前端，再加 `--features tauri/custom-protocol` 构建探针。

已验证一份含中文、SVG 提示块、矩阵、代码、110 行表格和超宽公式的五页 PDF；跨页表头及最终页面人工检查通过。另用 100 页 PDF 检查预览，起始和末尾均只挂载 2 张画布。该检查验证页面虚拟化，不代表任意 100 页复杂文档的生成时长或内存上限。当前本机未检测到 PATH 中的 Pandoc，外部格式实际转换仍需安装后验收。

一万行、1000 个公式的独立浏览器检查中，起始渲染 9 个公式，滚到末尾后剩 8 个，验证了远处 KaTeX DOM 回收。此结果不替代完整 Windows 进程组的内存和输入响应基准；也不等于整个 ProseMirror 文档已经虚拟化。
