# Markdown 输入辅助与格式交互

## 输入规则与文档语法的边界

输入辅助不修改文件解析语法。可视化模式在独立引用段落输入 `> [!` 或 `> [!]` 时展示 Note、Tip、Important、Warning、Caution，顺序由 `alertPresentation` 的共享元数据定义；继续输入英文前缀可筛选。方向键选择，Enter/Tab 确认，Esc 关闭，鼠标也可选。确认通过 `alertCommands.completeAlert` 替换当前单段引用并将选区放进提示块正文。已有完整类型的 Enter 转换共用此命令。

`AlertCompletion` 复用 TipTap Suggestion 的生命周期和 Floating UI 定位；只匹配当前不超过 14 字符的标记段落，不扫描文档。菜单挂载时才建立位置观察，退出和编辑器销毁时清理。源码使用 CodeMirror 补全，与可视化模式共用类型和排序，插入标准 `> [!TYPE]` 和下一行引用前缀。两种模式均忽略代码中的标记与输入法组合过程。

`MarkdownTypingKeys` 只在段落内容恰为三个 U+00B7 `···`、空选区位于行尾且按 Enter 时转代码块。源码模式插入标准反引号围栏并进入空白正文；代码内部不触发。打开、粘贴和导出文件不重新解释中点成对围栏。普通句子、ASCII `...`、带前后文的中点都保留。

## 快捷键

可视化与源码模式使用 Ctrl/Cmd+1…6 设置标题，Ctrl/Cmd+0 恢复正文，Ctrl/Cmd+U 切换下划线。`core/shortcuts` 的应用命令仍在捕获阶段处理；浏览器默认行为兜底在冒泡阶段取消，让编辑器先处理 Ctrl+U，避免 ProseMirror/CodeMirror 因 defaultPrevented 跳过格式快捷键。

## 高亮与选区状态

`HighlightControl` 是顶部与选区工具栏共用的分体按钮。左侧在当前选区有高亮时取消，否则应用上次颜色；右侧打开带键盘导航的颜色菜单。选色用 `setHighlight`，不会因选择相同颜色反而取消。笔尖展示当前选区颜色；无高亮时展示上次颜色。工具偏好由 `highlightPreference` 单独记忆，持久化为本地 UI 偏好，不增加正文元数据。

`useFormattingUpdates` 仅订阅真实内容、选区与 stored marks 变化，一帧合并刷新格式工具栏；公式和高亮装饰的懒加载事务不触发更新，也不刷新全文 React 树。选区浮层保持稳定的 BubbleMenu 配置引用，防止 UI 更新反向触发编辑器事务循环。

源码工具栏与快捷键共用 `sourceFormatting`。彩色高亮写为现有解析器支持的 `<mark data-color="…">`，下划线为 `<u>…</u>`。格式动作针对选区边界和选中文本，不物化整份文档。跨多个独立标记的源码选区不视为单一可取消标记。
