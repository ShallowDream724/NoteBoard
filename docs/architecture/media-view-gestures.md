# 媒体查看与手势

Windows WebView2 的 pinch 开关与 `zoomHotkeysEnabled` 绑定。主窗口配置和后续创建窗口均启用这个原生开关，使 Precision Touchpad 双指手势能到达前端。`core/mediaGestures` 在捕获阶段取消页面级缩放默认行为，不停止事件传播；局部媒体视口用非 passive wheel listener 接管 Ctrl/Meta + wheel（Chromium pinch），普通正文滚动仍由浏览器处理。

图片标签页、单图放大及图片组合的放大视图共用 `imageWheelGesture`。连续手势直接积累变换引用，不等 React 下一帧提交后才计算下一次缩放；缩放以指针所在点为中心并限制范围。图片组合中的有效图片单击进入 body portal 放大视图，避免 NodeView 和正文滚动容器裁剪。

Mermaid 的 `SvgDiagramViewport` 将正文与全屏的查看布局分开。正文 Ctrl + 滚轮或双指缩放时，以图表顶部和起始边为锚点，同步扩展当前块的实际宽高；超宽图表由局部横向滚动条或拖动浏览，两端始终可达。普通滚轮仍滚动文档。全屏继续使用指针中心缩放及双轴拖动。查看变换不进入 NB/MD、撤销历史或导出快照。

正文视口只观察自身宽度，按 SVG 的有效 viewBox（或绝对 width/height）计算初始适宽尺寸。缩放事件在组件局部引用中累积，每个动画帧只更新该图的占位尺寸和变换，不触发 React 状态、文档事务、全文扫描或 Mermaid 重新渲染。容器宽度变化由 ResizeObserver 局部重算；占位高度变化不重复调度。浏览器仍需为块高度变化计算后续文档流的必要布局。SVG 始终保留自然尺寸，小图不放大填满正文；打印仍独立使用自然尺寸，超出页宽才缩小。

原生开关的回归需在真实 WebView2 环境验收；合成 ctrl-wheel 测试只能确认前端事件接管和变换，不能替代具体触控板硬件验证。
