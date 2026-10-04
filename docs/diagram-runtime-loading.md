# 图表运行时加载边界

`manualChunks` 必须按真实所属包判断，不能用路径 `includes('mermaid')`：pnpm 路径和 `@excalidraw/mermaid-to-excalidraw` 都会误中。过去把转换器与 Mermaid 合包后，转换器的文字处理依赖又静态引入包含整个画板引擎的 Excalidraw chunk，普通图表渲染因此加载了无关编辑器。

现在仅显式归组 React 客户端/服务端与 KaTeX。Excalidraw 和 Mermaid 由 Rollup 按真实模块图分块，转换器只在真正请求画板转换时加载。强行把整个 `@excalidraw/excalidraw` 包聚合成单块，会让其入口和包含 open-color、jotai、roughjs 的共享模块互相静态依赖，在正式产物中触发 `Cannot access … before initialization`。开发服务器不经过同一分块过程，因此开发环境可打开不能替代生产回归。

画板的唯一懒载入口是 `editorLoaderFactories.board`。`BoardEditor` 在这个动态入口内部静态导入 Excalidraw，引擎初始化结束前，宿主资源保持 `loading`；导入失败直接进入宿主 `error`，显式重试由 `retryEditorLoad('board')` 重建失败资源。成功资源跨宿主共享。画板内部不再保留第二份加载 Promise 或吞掉导入异常，避免界面永久停留在加载占位。重试不刷新页面、不修改文档内容，也不启动后台自动重试。渲染异常继续由画板错误边界处理。

宿主重建资源不能清除浏览器原生 ESM 模块映射中的失败记录。Chromium 中同 URL 的动态模块抓取/求值失败可能在显式重试后继续失败；此时保留可见错误、文档和关闭入口，沿用界面的保存后安全重启提示。不会为此创建不断变化的模块 URL 或重复引擎实例。

生产回归：先 `pnpm exec vite build --outDir .tmp/board-loading-dist`，再运行 `node scripts/check-board-loading.mjs --dist .tmp/board-loading-dist` 和 `node scripts/check-budget.mjs --check --dist .tmp/board-loading-dist`。浏览器脚本使用已安装的 Playwright（可由 `PLAYWRIGHT_MODULE` 指定）与 Edge（可由 `BROWSER_CHANNEL` 指定），关闭外网请求，验证新建画板、绘制、撤销/重做、引擎请求失败的可见错误与显式重试，以及思维导图/多维表格入口。预热后再完成 5 轮画板绘制与关闭，以 CDP 全 GC 后 JavaScript 堆、DOM 节点和 JS 事件监听数检查关闭后的保留情况，并核验引擎不重复抓取。结果保存在 `test-results/board/loading-production.json`；该堆数据不代表原生窗口或整个渲染进程的内存。启动预算从构建模块来源清单核验，不能依赖 chunk 名称。此测试模拟 Tauri IPC，不覆盖原生窗口或真实文件写入。

构建图对比：Mermaid 引擎的增量静态依赖从 7,252,700 字节降至 623,051 字节；实际图种仍会按需加载自己的渲染模块。此数字是 JavaScript 文件大小，不是运行内存。内存需在相同文档、窗口、DPI、操作和采样时点另行测量，不能换算为已经减少 100 MB。
