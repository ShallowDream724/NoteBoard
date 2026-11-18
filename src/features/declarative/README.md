# 声明式作者源码

`.nb` 磁盘格式继续使用原生帧。此目录提供独立的可读作者源码投影，也为 Markdown 文件增加同一套声明式语法。

- `registry.ts` 是命令、别名、参数字段、模板与类型校验的共同目录。`internal` 条目是无损保留机制，普通提示与 AI 新内容应过滤。
- `syntax.ts` 将声明式命令注册为 Marked 扩展 token；宿主 Markdown 仍由现有 `MarkdownManager` 的 helpers 解析。每个内容组独立解析，不允许 Markdown 样式跨组配对。块匹配使用显式围栏栈，尊重代码、数学及宿主容器。
- `resolve.ts` 统一处理前向引用、重复定义、说明交互边界及原生保留校验。临时载体在进入 ProseMirror schema 前消解，说明正文集中存入 `annotationStore`。
- `codec.ts` 是无编辑器依赖的适配层。在 `installPresentationCodec` 之后调用 `installAuthoringCodec(manager, schema)`。另建的标准 Markdown 导出 manager 不安装此适配层。
- `authoring.ts` 提供面向界面的 `parseAuthoring(source)`、`serializeAuthoring(doc)` 及路径 source spans。路径始终是最终文档子节点索引；文字与公式 payload 的 `offsets` 使用 UTF-16 绝对源码坐标。
- `sourceCache.ts` 将源码投影绑定到 PM 文档身份。物化后调用 `rememberAuthoringSource(doc, parseResult)`；原生帧重建时调用 `inheritAuthoringSource(oldDoc, newDoc)`。grammar 的事务插件自动继承普通编辑产生的文档。无身份的 JSON 序列化采用规范写法，不通过全局内容指纹猜测文档来源。

原文、诊断、位置属于源码投影。文字修改按 UTF-16 偏移替换发生变化的子串。段落插入和删除以未改动的相邻节点为边界，列表增删项目优先沿用原有编号或项目符号。补丁用同一解析器核对文档结构。需要重新生成的 Markdown 块优先使用标准写法，声明式表达和原生保留形式用于承载 Markdown 表达不了的属性和结构。源码模式和磁盘保存约定见 [Markdown 持久化](../../../docs/markdown-persistence.md)。

错误块使用可编辑的 `authoringRaw`，错误行内候选使用 `authoringLiteral`。视觉修改产生的字面恢复内容通过校验的 `native` 形式保存，避免原文恰好变成合法命令后被自动执行；源码编辑则按照作者的新源码重新解析。

解析结果直接向 PM 文档传递源码投影。仅持有原文的兼容入口也可以按精确源码查找最近 16 条、总量不超过约 4 MiB 的投影。持续存在的编辑文档通过 WeakMap 保留自己的投影。普通事务只继承引用，完整词法扫描与语义核验发生在打开、切换或物化快照时。
