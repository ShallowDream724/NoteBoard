export const GUIDE_WORD = '把想法写下来';
export const GUIDE_NOTE = 'showcase-welcome';
export const GUIDE_DISCLOSURE = '旅程记录清单';
export interface GuideStep {
  id: string;
  title: string;
  instruction: string;
  success: string;
  autoAdvance?: boolean;
}
/** One visible target and one real outcome per step, inside the actual sample. */
export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'read-note', title: '先看一条补充说明', instruction: '把鼠标移到圈出的问号上，也可以点击它。', success: '说明已展开。读完后，我们试试改一处文字。' },
  { id: 'selection', title: '拖选圈出的这句话', instruction: '按住鼠标，从“把”拖到“来”。', success: '选中了', autoAdvance: true },
  { id: 'highlight', title: '点这里，加上高亮', instruction: '文字已选中。点击圈出的彩色 A，给它加上背景色。', success: '高亮已添加', autoAdvance: true },
  { id: 'annotation-open', title: '给这句话留个批注', instruction: '点击圈出的“添加说明”。', success: '可以写说明了', autoAdvance: true },
  { id: 'annotation-save', title: '写一句，再保存', instruction: '在圈出的编辑区写一句话，再点击“保存”。', success: '说明已留在这句话旁边。' },
  { id: 'insert-menu', title: '用键盘插入内容', instruction: '点击圈出的空行，输入 /note。', success: '命令已经找到', autoAdvance: true },
  { id: 'insert-callout', title: '选择 Note', instruction: '点击圈出的 Note，或按 Enter。', success: '提示块已插入，可以直接在里面写字。' },
  { id: 'disclosure', title: '展开这份清单', instruction: '点击圈出的箭头，看看折叠块里的内容。', success: '详细内容展开了，再点一次就能收起。' },
];
