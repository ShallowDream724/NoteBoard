# 操作提示与上下文帮助

`Tooltip` 保留简单操作的文字与快捷键提示；复杂叶子操作通过显式 `helpKey` 使用紧凑的用途说明和只读 DOM 预览。`ToolbarButton`、`ToolbarDropdownItem` 透传相同 API。目录在 `src/components/contextualHelp.tsx`，根据操作语义和作用范围选 key，不根据按钮中文名称推断行为。

普通提示默认延迟 100ms；带示意的帮助默认延迟 650ms，而且不会因为邻近提示刚打开而跳过等待。预览模块及共享展示 CSS 仅在首次打开复杂帮助时加载，避免进入首屏闭包；预览 DOM 仅在提示打开时挂载，关闭即释放，不加载远程资源、编辑器实例或公式渲染器。预览复用真实内容的类名、纯展示样式和语义元数据，容器整体缩小至 75%，不重画另一套控件。

提示块的五种类型分别使用 `block.callout.note/tip/important/warning/caution`，其图标、标题与颜色来自 `calloutPresentation`。通用提示块展示实际默认 Note 空块。折叠块展示真实默认标题“更多内容”和空正文；新增公式展示空源码状态，块公式带真实完成快捷键。表注与图注分别预览表格和图片，不共用图片示意。阅读视图公式使用预生成的固定 KaTeX DOM，复用编辑器已加载的公式样式，不在帮助路径导入 KaTeX 运行时。

整表位置和单元格对齐的叶子操作使用各自的方向键，预览展示该操作的结果。取消表头另用 `.clear` 键，预览恢复普通单元格；将既有内容包成提示块使用 `block.callout.wrap`，展示保留正文的结果。卡片保留 286px 的可读宽度，仅受整个视口宽度限制；当前位置放不下时由 Radix 翻转到另一侧，避免压缩成极窄的文字列。

常见格式使用 `block.paragraph`、`block.heading.1` 至 `.6`、`list.bullet/ordered/task` 和 `block.code/quote/divider`。顶部工具栏、插入菜单、空行插入和已有块的格式菜单共享这些操作身份。列表预览使用 `ul/ol/li`；待办复用 `li[data-checked] > label > input[type=checkbox]` 与正文 `div > p` 结构，展示已完成和未完成事项。代码示意保留实际语言、折叠、换行、复制头部及行号，三行固定代码仅使用主题高亮变量，不加载高亮器或可编辑节点。已有描述的斜杠菜单保持原有简洁表面。

`format.clear`、`format.restore` 和 `text.link` 分别展示清除文字样式、解除文字结构及链接的实际语义。清除前后保留超链接；完整段落也清对齐、缩进和底色，完整提示块的自定义外观恢复默认。还原前后保留文字样式，整块提示/折叠容器可解除外壳；插入空正文仍使用 `block.paragraph`。插入入口和左侧块菜单使用这些预览。文字、图注和表格浮动辅助栏在根部使用 `TooltipDetailProvider rich={false}`：包括 portal 子菜单在内仅显示文字和快捷键，不挂载或加载图文预览。清样式 Ctrl+\\ 和还原 Ctrl+0 由当前绑定的独立标签显示。

图片模板使用 `image.collection.4/6/9/carousel`，入口映射集中在轻量 `contextualHelpKeys.ts`，以类型关联公开的 `ImageTemplate`，不把 UI 标识写入内容配方。四宫格为两列四格，六宫格为三列六格，九宫格为三列九格；轮播默认三格。示意复用实际 `nb-image-collection`、viewport、slots、slot 与分页 DOM 和 `carousel.css`，本地 SVG 代替用户图片，并标明“添加图片后的效果”；插入仍是空格。已有组合重排使用 `image.collection.columns.2/3` 与 `image.collection.layout.carousel`，说明保留现有图片和图注。

只有轮播示意有一次有限演示：每张停留 1600ms，以 180ms 的 CSS transform 过渡从第一张到第三张即停止，真实圆点、隐藏计数和箭头状态同步。挂载后仅持有一个短计时器，不创建编辑器的 CollectionView、滚动观察器或永久循环。关闭时清理计时器与监听；页面隐藏或减少动态效果设置生效时停止，初次已启用减少动态效果时保持第一张静态。其余示意没有动画或计时器。

快捷键传已有命令的默认绑定标识，由 `useResolvedShortcutLabel` 解析当前自定义设置。未设置的绑定不显示。没有对应键盘命令的动作不虚构快捷键。

复杂帮助支持指针移入卡片继续阅读，并通过 `HoverMenuContext` 保留所属菜单。卡片无可聚焦控件，不移动编辑器选择；点击卡片或按 Escape 关闭。叶子菜单的帮助优先放在侧面，Radix 负责视口碰撞和翻转，宽度受视口约束。显示颜色复用主题变量，插图随晨光、琥珀、墨夜自动变化。

禁用、目录项或没有内容的提示保留稳定的触发节点，但在触发层阻止底层打开尝试，避免 Radix 的全局打开通知关闭其他正在阅读的卡片。指针穿过嵌套菜单的间隙不会被无可见内容的父提示打断。

已接入左侧块菜单的整表位置、单元格文字对齐、表头行/首列、全文表格样式、全文公式/表格阅读视图、补充说明与图注/表注；空块插入菜单接入提示块、折叠块及行内/块公式。常见格式与图片模板覆盖顶部及空行入口，图片组合重排覆盖块菜单。菜单结构、顺序与原操作回调保持一致。

`test/contextualHelp.test.tsx` 验证延迟挂载、关闭释放、焦点保留、自定义快捷键、各提示块类型、表注/图注区别、空公式状态、图片布局与真实配方一致、列表/待办/代码结构以及轮播一次播放、减少动态效果与后台清理。`test/contextualHelpEntries.test.tsx` 验证各实际入口共用语义 key，并确认图片插入、重排回调仍执行原有操作。`test/browser/contextualHelp.html` 提供实际 Tooltip 检查入口；`?gallery&theme=chen-guang` 展示全部预览，`?compare&sample=block.callout.tip&theme=mo-ye` 将选定预览与真实编辑器并排展示。重型编辑器仅属于浏览器测试入口。
