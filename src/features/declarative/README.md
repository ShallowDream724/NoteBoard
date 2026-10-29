# 声明式作者源码

`.nb` 磁盘格式继续使用原生帧。此目录提供独立的可读作者源码投影，也为 Markdown 文件增加同一套声明式语法。

- `registry.ts` 是命令、别名、参数字段、模板与类型校验的共同目录。`internal` 条目是无损保留机制，普通提示与 AI 新内容应过滤。
- `syntax.ts` 将声明式命令注册为 Marked 扩展 token；宿主 Markdown 仍由现有 `MarkdownManager` 的 helpers 解析。每个内容组独立解析，不允许 Markdown 样式跨组配对。块匹配使用显式围栏栈，尊重代码、数学及宿主容器。
- `resolve.ts` 统一处理前向引用、重复定义、说明交互边界及原生保留校验。临时载体在进入 ProseMirror schema 前消解，说明正文集中存入 `annotationStore`。
- `codec.ts` 是无编辑器依赖的适配层。在 `installPresentationCodec` 之后调用 `installAuthoringCodec(manager, schema)`。另建的标准 Markdown 导出 manager 不安装此适配层。
- `authoring.ts` 提供面向界面的 `parseAuthoring(source)`、`serializeAuthoring(doc)` 及路径 source spans。路径始终是最终文档子节点索引；文字与公式 payload 的 `offsets` 使用 UTF-16 绝对源码坐标。
- `sourceCache.ts` 将源码投影绑定到 PM 文档身份。物化后调用 `rememberAuthoringSource(doc, parseResult)`；原生帧重建时调用 `inheritAuthoringSource(oldDoc, newDoc)`。grammar 的事务插件自动继承普通编辑产生的文档。无身份的 JSON 序列化采用规范写法，不通过全局内容指纹猜测文档来源。

原文、诊断、位置属于源码投影。未修改文档保留原始字节；已知位置的文字、公式、单命令样式及容器参数修改优先打局部补丁，并在切换或保存时用同一 parser 验证。结构变化无法安全补丁时采用规范序列化。原生保留形式覆盖尚无声明式映射的属性和节点，避免丢弃合并表格、旧缩进等内容。

错误块使用可编辑的 `authoringRaw`，错误行内候选使用 `authoringLiteral`。视觉修改产生的字面恢复内容通过校验的 `native` 形式保存，避免原文恰好变成合法命令后被自动执行；源码编辑则按照作者的新源码重新解析。

最近解析结果到 PM 物化之间的桥接缓存按精确源码索引，最多 16 条、估算总量 4 MiB（包含文档与 spans）；持续存在的编辑文档通过 WeakMap 保留自己的投影，不会与同语义但排版不同的另一文档串源。普通事务只继承引用，不扫描全文。完整词法扫描与语义核验发生在打开、切换或保存边界。
