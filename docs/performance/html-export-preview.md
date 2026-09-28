# 独立 HTML 与预览验证

2026-09-28 的受控浏览器样本包含 `\mathcal{L}`、`aligned`、`cases` 和两张轮播图。生成文件为 402,470 字节，含离线 KaTeX WOFF2 字体。测试页面施加与应用相同的 `script-src 'self'`，预览 iframe 使用不带 `allow-same-origin` 的沙箱。Edge 无头浏览器确认：预览和 `file://` 副本都能翻页；预览中的作者脚本未执行；两者保持 standards mode，KaTeX_Caligraphic 已加载，公式主体的宽高与同页 KaTeX 基线均为 171.921875 × 120.59375 px。

同一页面以 `--enable-precise-memory-info --js-flags=--expose-gc` 在各状态采样 `performance.memory.usedJSHeapSize`：

| 状态 | CodeMirror | iframe | JS 堆 |
| --- | ---: | ---: | ---: |
| 仅源码 | 1 | 0 | 14,895,173 字节 |
| 模拟旧版源码与预览同驻 | 1 | 1 | 19,964,595 字节 |
| 当前预览 | 0 | 1 | 16,982,908 字节 |

当前预览比同驻对照少 2,981,687 字节，约 14.9%。这是小样本的浏览器 JS 堆对照，不包括 WebView 原生资源、解码图片或整应用进程工作集，也不能按比例推算大型文档。复测脚本为 `scripts/check-html-export.mjs`，结果写入 `.tmp/html-export-browser-results.json`。
