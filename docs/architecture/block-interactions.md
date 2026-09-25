# 内容块操作与撤销

`blockDragHandle` 管理指针会话和菜单生命周期，`blockActions` 管理选中、复制、删除与格式命令，`blockReorder` 管理落点和原子移动。正文仍按顶层块移动；列表命中具体 `listItem` / `taskItem`，以该项及子列表为单位。表格内部内容不成为文档块拖动入口。

`listItemActions` 校验目标 schema。列表内移动保留节点和 marks；移到正文位置时保留一个同类型列表包装器。删除唯一列表项同时删除空包装器。标题折叠后的章节范围由 `headingFolding` 提供，改变标题级别只处理标题，引用等范围操作处理整段章节。

拖动目标索引按编辑器状态弱缓存，首次构建 O(B)，每次指针落点二分查找 O(log B)，B 为可拖动块数。移动时保留内容节点，不将文档变成 HTML 再解析。浏览器布局仍有自身成本。

把手的隐藏计时器在菜单展开时取消，回调再次检查菜单和手势状态；点击把手保留组件，超过拖动阈值后才收起菜单。标题标签隐藏使用编辑区外的 CSS 规则，避免修改正文 DOM 属性触发 ProseMirror 重解析。把手位置不变时复用 React 状态。

`dispatchEditorShortcut` 规范化目录中的按键名，直接执行 ProseMirror keymap。这里不能使用 TipTap `keyboardShortcut` 的事务捕获：应用级撤销适配器需要同步读取替换后的文档，且替换元数据不能丢失。键盘和工具栏均进入 `documentHistory`，原生文档与 Markdown 共用时间线。`documentKeyboardHistory.test` 挂载真实协调器验证物理 Ctrl+Z、重做、尺寸操作和块移动，不用底层 `editor.commands.undo()` 替代应用撤销验收。
