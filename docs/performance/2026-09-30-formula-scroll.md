# 右对齐公式的滚动边界

正常宽度的右对齐公式在滚动阅读模式中不再产生 2px 横向滚动范围。超宽公式仍保留自然宽度和完整的局部横向滚动。

## 容器契约

KaTeX 的 `.vlist-s` 是宽度为 2px 的表格单元格，其不可见布局边界可能超出右对齐公式的可见基组。`core/math/scrolling.css` 按 `data-math-align` 定义 `--math-scroll-inline-end`：右对齐为 2px，左对齐和居中为 0px。该样式只定义几何余量。

滚动消费者在自身 `border-box` 视口中以 `padding-inline-end` 消费这个变量，继续自行管理 `overflow`。编辑器仅在公式 `scroll` 阅读方式中消费；独立 HTML 在屏幕阅读时消费，打印时清零。自然展开和换行策略无需该余量。此修复没有隐藏滚动条、裁剪公式或重写 KaTeX 标记，也没有新增文档事务或数学渲染流程。

## 验证

执行 `node scripts/check-formula-scroll.mjs`，需要可解析的 Playwright 模块；可用 `PLAYWRIGHT_MODULE` 指定模块位置。脚本在 `.tmp/formula-scroll-dist` 独立构建真实 `TipTapEditor`、生产数学 Worker 和 `renderDocument` → `standaloneHtml` 导出链路；HTML 用 `file://` 离线打开。测试使用原生 `.noteboard` 文档承载对齐属性，遵守文档格式能力约束。

环境：本机 Windows、Edge 无头浏览器，1400×1000。短式含分段函数、积分与分式；长式为 90 项带下标求和。两端分别覆盖左对齐、居中、右对齐，共 12 项几何检查。

| 观察 | 编辑器 | 独立 HTML |
| --- | --- | --- |
| 短式，三个对齐方式的 `clientWidth / scrollWidth` | 1156 / 1156px | 834 / 834px |
| 短式，最大 `scrollLeft` | 0px | 0px |
| 长式，三个对齐方式的 `scrollWidth` | 4343px | 4343px |
| 长式，最大 `scrollLeft` | 3187px | 3509px |
| 右对齐短式临时去掉余量后的多余滚动范围 | 2px | 2px |

验证同时确认公式可见基组完整、左/中对齐无需余量、切回展开后编辑器释放余量、HTML 打印释放余量、阅读方式保留序列化原文、离线页面零网络请求和零页面错误。脚本 ESLint 检查通过；右对齐编辑器和 HTML 截图均已检查，无多余横向滚动条。

原始结果和截图写入 `.tmp/formula-scroll-results.json`、`.tmp/formula-scroll-editor.png`、`.tmp/formula-scroll-html.png`；复用现有验证构建时可加 `--reuse`。
