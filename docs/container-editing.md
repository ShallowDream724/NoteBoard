# 容器编辑边界

## 图片后的续写

`containerEditing.ts` 共用容器末尾补段落、定位光标与键盘续写。图片插入、剪贴板内容导入、空段落插入、表格插入都调用 `ensureContainerTail`；只检查原始插入点的祖先，不遍历文档。支持折叠块、Callout（含 Note/Tip 等预设）、引用及表格单元格。

末尾是图片、图片组合、表格、公式、图示、分隔线或嵌套 Callout/折叠块时补一个可编辑段落；已有后续段落则不重复添加。插入内容与补段落属于同一次事务。嵌套容器只修复最近的容器。

Callout 的 React 视图与折叠块的 DOM 视图共用 `continueContainerWriting` / `handleContainerTailKey`。已有文档以图片等块结束时，底部提供可点击空行；选中末尾块按 Enter / 向下箭头，也能进入容器内的新段落。视图不在加载文档时静默修改内容，打印不显示续写按钮。

## Ctrl+A

`ContainerSelectAll` 是可视化编辑器的统一入口，优先于默认全选；不影响源码编辑器或输入框。

- Callout、折叠块、代码块、引用、无序/有序/待办列表、表格、图片组合：第一次选中最近容器内部的全部内容，提示“再按一次 Ctrl+A 全选全文”。
- 嵌套时从最近容器直接升级到全文，不逐层升级。表格使用完整 `CellSelection`，保留已有批量操作语义。
- 普通正文或跨容器的选区一次全选全文。连续按住按键不升级选区；编辑、移动选区、点击或失焦后重新从局部选择开始。
- `ContainerContentSelection` 精确覆盖首尾图片等原子块。删除内容保留可编辑的空容器；撤销恢复内容和选区。代码块继续使用 `TextSelection`。

状态仅保存在对应编辑器的 ProseMirror 插件中，不使用全局光标状态、定时器或全文扫描。图注/公式弹窗等独立编辑器保持自身的全选边界。

回归覆盖：`containerEditing.test.tsx`、`containerSelection.test.ts`、`disclosureEditing.test.ts` 和 `textFormatting.test.ts`。
