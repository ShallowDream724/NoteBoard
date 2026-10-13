# PlantUML 在线预览

打开 PlantUML 文件或文档中的 PlantUML 块不会上传图表源码。节点预览和分栏编辑器提供“启用在线预览”，明确说明本视图的图表源码会发送到 `plantuml.com`。授权只保存在当前打开的视图中，不写入文件、设置或恢复状态；关闭在线预览后，新的源码继续本地编辑。重新打开视图或切换到另一份图表文件需再次启用。已存在的安全缓存可以直接显示。

`plantumlEncoder.ts` 是唯一网络渲染边界。`renderPlantUmlToSvg(code, signal, { allowNetwork })` 默认 `allowNetwork=false`，缓存命中直接返回 SVG；缓存缺失且未授权时返回 `permissionRequired`，界面显示启用提示而非渲染错误。已授权预览请求只访问 `https://www.plantuml.com/plantuml/svg/…`，不携带凭据和 referrer，拒绝重定向，并在 20 秒后取消。加载错误不进入缓存，界面可重试。

源码上限为 128 KiB UTF-8。响应按流读取，累计超过 2 MiB 时立即取消；声明的过大 Content-Length 也直接拒绝。缓存按源码、SVG 字符串的 UTF-16 占用及条目开销估计字节数，LRU 总量限制为 8 MiB，仅缓存成功清洗的图形。源码变更、视图变为后台、预览隐藏及卸载会取消待执行任务与已开始的请求；废弃结果不会更新界面。返回此前源码时从共享缓存恢复，避免空白预览。

`plantumlSvg.ts` 在 SVG 进入界面、缓存和导出前统一清洗：DOMPurify SVG profile 删除脚本、foreignObject、SMIL 动画、嵌入页面和链接；再次移除事件属性、外部 href、CSS 网络引用及动态 CSS 函数。保留安全的描边、颜色、文字样式和本地 SVG 片段引用，不信任渲染服务返回的 HTML 或样式表。分栏编辑器的缩放和平移、块内全屏与图片导出只接触清洗后的 SVG。

文档 HTML/PDF 导出明确传入 `allowNetwork=false`，只复用当前进程已生成的安全缓存。未缓存的 PlantUML 保留源码并报告图形缺失；导出流程不会替用户启用在线上传。Mermaid 与信息图仍使用其本地共享渲染器。

回归：`test/plantuml/plantumlRendering.test.ts` 验证默认离线、导出、恶意 SVG、源码与响应限额、流取消、超时、重试及缓存淘汰；`plantumlConsent.test.tsx` 验证两类界面的授权、后续源码修改、取消与恢复。测试使用本地模拟响应，不发送实际图表源码。
