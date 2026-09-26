# 图表运行时加载边界

`manualChunks` 必须按真实所属包判断，不能用路径 `includes('mermaid')`：pnpm 路径和 `@excalidraw/mermaid-to-excalidraw` 都会误中。过去把转换器与 Mermaid 合包后，转换器的文字处理依赖又静态引入包含整个画板引擎的 Excalidraw chunk，普通图表渲染因此加载了无关编辑器。

现在仅显式归组 React 客户端/服务端、Excalidraw 核心与 KaTeX。Mermaid 保留库自身的动态图种模块，转换器只在真正请求画板转换时加载。组件、保存、编辑器存活和历史策略不变。

构建图对比：Mermaid 引擎的增量静态依赖从 7,252,700 字节降至 623,051 字节；实际图种仍会按需加载自己的渲染模块。此数字是 JavaScript 文件大小，不是运行内存。内存需在相同文档、窗口、DPI、操作和采样时点另行测量，不能换算为已经减少 100 MB。
