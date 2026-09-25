# 媒体查看与手势

Windows WebView2 的 pinch 开关与 `zoomHotkeysEnabled` 绑定。主窗口配置和后续创建窗口均启用这个原生开关，使 Precision Touchpad 双指手势能到达前端。`core/mediaGestures` 在捕获阶段取消页面级缩放默认行为，不停止事件传播；局部媒体视口用非 passive wheel listener 接管 Ctrl/Meta + wheel（Chromium pinch），普通正文滚动仍由浏览器处理。

图片标签页、单图放大及图片组合的放大视图共用 `imageWheelGesture`。连续手势直接积累变换引用，不等 React 下一帧提交后才计算下一次缩放；缩放以指针所在点为中心并限制范围。图片组合中的有效图片单击进入 body portal 放大视图，避免 NodeView 和正文滚动容器裁剪。

Mermaid 的 `SvgDiagramViewport` 只保存组件内的查看变换，Ctrl + 滚轮或双指缩放后可拖动查看。普通滚轮仍滚动文档。查看变换不进入 NB/MD、撤销历史或导出快照。SVG 初始宽度采用有效 viewBox 的自然宽度、受容器最大宽度限制；打印同样按自然尺寸呈现，超出页宽才缩小，不放大小流程图填满整页。

原生开关的回归需在真实 WebView2 环境验收；合成 ctrl-wheel 测试只能确认前端事件接管和变换，不能替代具体触控板硬件验证。
