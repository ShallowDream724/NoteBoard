# Markdown 历史物化与内嵌信息图

## 历史全文缓存

`documentHistory.ts` 使用检查点和可逆补丁压缩历史，每 20 个历史组保存检查点。当前节点的完整内容已经由记录或导航得到时，后续读取直接使用 `lastMaterialized`；前后相邻导航最多应用一个可用补丁。读取检查点也更新缓存，使紧接着的重做可以从该检查点继续。

历史超过 201 个节点时，先将幸存首节点物化为检查点，再裁掉旧节点，最后按新索引恢复当前全文缓存。缓存只能引用裁剪后的索引；临时物化首节点不能覆盖最终的当前节点缓存。

此前同索引读取漏掉缓存命中：100 万字符文档在第 19 组时，每次读取会重放 19 个补丁，下一次记录还会在内容比较和新节点构造中重复重放。`historyMaterialization.test.ts` 通过补丁片段 getter 统计实际应用次数，验证重复读取和第 20 组记录合计为 **0 次**，跨检查点重做为 **1 次**，裁剪后当前读取为 **0 次**。这些断言不依赖机器速度。

## 内嵌信息图激活

`infographicExtension.tsx` 通过共享 `viewportActivation` observer，在节点首次进入视口上下左右 800px 的预加载范围后激活。未激活节点只保留轻量工具栏和占位内容，不解析 YAML/JSON、不挂载 `InfographicRenderer`。没有 `IntersectionObserver` 时沿用共享实现的立即激活回退；直接编辑或打开全屏也会主动激活。

激活后保持图表，滚出预加载范围不卸载。这使小文档与滚回已访问图表的操作稳定，编辑草稿也不会受视口通知影响；预算只限制**尚未访问**的图表，浏览过整篇文档后已访问图表仍会保留 DOM。没有增加总 DOM 上限或后台回收策略。

配置解析以源码和首次激活状态为依赖缓存，图表组件通过 `React.memo` 复用未改变的数据。选区、工具栏、复制、全屏等 UI 状态不会重复解析同一份源码。交互样式放在模块级 CSS 中，由构建系统加载一次，节点内不再重复插入同一段 `<style>`。

内联和全屏仍分别登记 DOM；复制/导出只在对应节点挂载且解析成功时可用，关闭全屏后回到内联来源。`infographicViewport.test.tsx` 使用真实 TipTap NodeView、解析器、图表与导出菜单，替换 observer 通知及图片复制入口，验证屏外零解析/零渲染、首次激活、选择状态复用、编辑草稿、保存、内联/全屏复制来源以及直接全屏激活。

## 验证命令

```bash
node node_modules/vitest/vitest.mjs run test/history/documentHistory.test.ts test/history/historyStorage.test.ts test/history/historyMaterialization.test.ts test/editor-md/infographicViewport.test.tsx test/infographic/infographicParser.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

2026-09-23：上述 5 个测试文件共 27 项通过，TypeScript 检查通过。局部 ESLint 检查在加载仓库配置时因缺少 `globals` 包而中止，尚未执行规则检查。
