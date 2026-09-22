# 文件格式判定

`core/docKind.json` 与 `core/languageByExt.json` 是前后端共用映射。TypeScript 导入，Rust `dto::kind_by_ext` 通过 include_str 和 OnceLock 读取，不再维护第二份 match。大小写统一，未知扩展名默认纯文本候选，磁盘读取仍通过内容嗅探识别二进制。

DOCX、PDF、PPTX、XLSX、压缩包、媒体和程序等已知外部格式明确归类 Unsupported；即使它们最初是无扩展名空文件，也不会因内容恰为文本继续使用文字编辑器。`.dot` 保留为文本候选，兼容 Graphviz，实际二进制由读取层判定。

改名由 documentStore 重算类型和语言，windowStore 从文档记录刷新标签；已有正文和脏状态保留。首次打开外部格式由 `prepare_on_worker` 直接返回元信息，不尝试读成正文。测试覆盖无扩展名改多种外部格式及改回文本，前后端各验证真实流程。
