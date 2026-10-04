# 文件格式判定

`.nb` 与 `.nbdoc` 均归类 `noteboard`，使用同一个原生记录 codec 与可视化富文本内核。它们不经过 Markdown 解析，也不提供普通源码模式；损坏记录通过错误块进入恢复视图。自动保存、导出和大纲等共同行为使用 `isRichDocument` 判断；格式契约见 [native-documents.md](native-documents.md)。

统一“浏览”入口由 `welcome/PathBrowser` 管理文件与目录选择；`fsio/browse` 提供常用位置及磁盘列表，`read_dir` 在后台线程读取直接子项。前端以请求代次丢弃过期响应，按可见区域虚拟化列表；筛选只遍历当前目录，不递归读取子目录。目录结果仍需完整读取并排序后返回，虚拟化降低 DOM 成本，不等同于流式目录读取。确认后路径交给现有 `openDocument`，由同一入口决定打开文件还是加入文件夹。

`core/docKind.json`、`core/languageByExt.json` 与 `core/languageByFilename.json` 是前后端共用映射。TypeScript 导入，Rust `dto` 通过 include_str 和 OnceLock 读取，不再维护第二份 match。大小写统一，完整文件名优先于后缀（如 Dockerfile、Gemfile、.bashrc），未知扩展名默认纯文本候选，磁盘读取仍通过内容嗅探识别二进制。语言识别不覆盖文档类型，SVG 仍为图片，NB、图表和 HTML 仍走各自入口；此映射不注册 Windows 文件关联。

`core/codeLanguages.ts` 提供代码块与代码文件共用的纯语言元数据，TypeScript LanguageId 由它推导。所有代码块语言都有常见文件后缀覆盖；有歧义的 `.h` 默认 C，`.m` 默认 MATLAB，`.conf` 默认 INI。JavaScript/TypeScript 的 JSX/TSX、Shell 和配置别名保留统一语言标签。文件查看以阅读和基础编辑为限，没有编译器、调试器或项目索引。

状态栏也复用这份纯元数据展示 Python、C 等语言名称，不再把尚未挂载光标读数的代码文档统一显示成「纯文本」，且不会因此加载语法解析器。

文件编辑器保留原生 CodeMirror 语法，并为 Python、C/C++、PHP、JavaScript/TypeScript、CSS 按需载入原生解析器；其余语言按模块懒加载 `@codemirror/legacy-modes` 的 StreamLanguage。解析由 CodeMirror 增量、分时执行，保留多行词法状态，不在按键处理器中调用全文高亮。原生语法保留结构折叠，StreamLanguage 提供词法高亮与缩进；工具栏提供语言名称、跳转行、折叠及展开入口，并复用已有查找、换行、行号和原生复制。代码块的后台高亮服务独立保留。

DOCX、PDF、PPTX、XLSX、压缩包、媒体和程序等已知外部格式明确归类 Unsupported；即使它们最初是无扩展名空文件，也不会因内容恰为文本继续使用文字编辑器。`.dot` 保留为文本候选，兼容 Graphviz，实际二进制由读取层判定。

改名由 documentStore 重算类型和语言，windowStore 从文档记录刷新标签；已有正文和脏状态保留。首次打开外部格式由 `prepare_on_worker` 直接返回元信息，不尝试读成正文。测试覆盖无扩展名改多种外部格式及改回文本，前后端各验证真实流程。
