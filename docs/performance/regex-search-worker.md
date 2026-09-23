# 正则搜索的计算边界

语法合法的正则表达式仍可能回溯很久。搜索的用户表达式只在可终止的 Worker 内执行；主线程准入检查不构造或运行用户的 `RegExp`。普通文本搜索保留原路径，不被强制送入 Worker。

## 模块与接口

- `searchMatching.ts`：公开 `searchRegex(request, { signal })`，管理一个文档/查询快照对应的 Worker、取消和硬超时。成功、错误、取消之后都释放 Worker；没有 Worker 时返回明确错误，不回退到主线程执行正则。
- `regexProtocol.ts`：仅包含编辑器无关的请求、结果、准入预算和错误；不引用 CodeMirror、ProseMirror 或 DOM。
- `regexWorker.ts`：计算入口，转移结果的 `ArrayBuffer`，避免复制完整导航索引。
- `regexMatchingEngine.ts`：原生 `RegExp` 匹配及按需替换展开，只供 Worker 和聚焦测试使用。

请求包含按文档位置排列且互不重叠的 `{ text, from }` 文本段、表达式、大小写和可选行为。位置与 JavaScript 字符串一样以 UTF-16 单元计算。ProseMirror 可将跨 marks 的连续文本合为一段，以真实 `from` 映射结果；非文本节点打断段落。CodeMirror 使用全文一段及 `multiline: true`。引擎不擅自将独立 ProseMirror 文本段拼接成可跨块替换的字符串。

返回 `ranges: Uint32Array`，排列为 `[from, to, from, to, ...]`，完整导航索引最多 100,000 处／800,000 字节。只有替换命令才在请求中提供 `replacement`；结果的 `replacements?: string[]` 与各区间一一对应。导航不携带捕获组或替换文本的副本。

取消拒绝 Promise，错误名为 `AbortError`。其他失败 resolve `{ ranges: 空数组, error, limited }`；不会以部分结果冒充完整搜索或替换计划。错误文本是普通字符串，调用方可以持续展示并允许复制，原搜索内容保持可编辑。

## 保留的匹配行为

- 原生 Unicode 全局匹配（`gu`，忽略大小写时附加 `i`）；CodeMirror 附加 `m` 保持多行锚点。支持原生捕获、反向引用、前后查找及 Unicode 位置语义。
- 空匹配按 Unicode 码点前进，避免 `RegExp.exec` 的零宽死循环。ProseMirror 通过 `ignoreWhitespace: true` 排除空匹配和纯空白匹配。
- ProseMirror 的整词选项用原有 `\b(?:pattern)\b` 包装。CodeMirror 的整词行为依赖语言的 `charCategorizer`，由适配层过滤返回索引，同时过滤对应替换项。
- ProseMirror 替换为字面文本。CodeMirror 替换在 Worker 内处理其既有 `\n/\r/\t/\\`、`$$`、`$&` 和数字捕获规则，不在主线程再次匹配原表达式。
- 替换展开在拼接每个片段前核算输出预算，避免短替换模板通过重复 `$&` 无界放大。

## 硬预算与适配层责任

| 项目 | 完整请求上限 |
| --- | ---: |
| 文本段合计 | 16 Mi UTF-16 单元 |
| 文本段数 | 100,000 |
| 原表达式 | 4,096 UTF-16 单元 |
| 匹配区间 | 100,000 |
| 替换模板 | 16,384 UTF-16 单元 |
| 全部展开替换文本 | 4 Mi UTF-16 单元 |
| Worker 生命周期 | 1,000 ms，含启动与计算 |

文档位置必须能映射到 Uint32，超出范围拒绝。超时在主线程触发 `terminate()`，能够终止仍停留在一次 `RegExp.exec` 内的灾难回溯；仅检查表达式能否编译不构成此边界。

控制器按编辑器会话持有取消令牌，在查询、文档、关闭或销毁时取消旧快照；结果落地前核对文档和查询代际。导航复用紧凑索引，替换命令使用当前快照的独立请求；计算中或失败后不得应用旧替换结果。索引与 DOM 高亮分离，由适配层仅挂载可见范围及当前匹配，窗口装饰上限 2,000，不为 50,000 个索引同时构造 DOM 高亮。这些编辑器适配由 `searchController` 和搜索扩展负责。

## 聚焦验证（2026-09-23）

`node node_modules/vitest/vitest.mjs run test/search/searchMatching.test.ts`：8 项合同覆盖原生匹配、Unicode 零宽推进、多段位置、替换捕获语义、100,000 个紧凑索引、预算拒绝、取消隔离、超时终止及无 Worker 时不执行同步回退。

`node scripts/verify-regex-worker.mjs`：构建独立生产配置页面，使用本机 Edge 的真实 Worker，不挂载编辑器或高亮 DOM。结果写入 `.tmp/regex-worker-verification/results.json`。本次结果：

- 50,000 个 `word` 匹配完成于 18.2 ms，导航索引为 400,000 字节。
- `(a+)+$` 对 32 个 `a` 后接 `!`，在约 1000.8 ms 被硬超时终止；等待期间主线程 10 ms 心跳执行了 100 次。
- 取消返回 `AbortError`，随后新的 Unicode 捕获查询与替换正常完成。

这是单次真实 Worker 合同核验，不是编辑器端到端性能承诺；它证明灾难表达式不会占住主线程，并验证实际线程终止和下一次查询恢复。
