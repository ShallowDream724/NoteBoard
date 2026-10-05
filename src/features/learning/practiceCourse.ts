export const GUIDE_WORD = '把想法写下来';
export const GUIDE_NOTE = 'showcase-welcome';
export const GUIDE_DISCLOSURE = '旅程记录清单';
export interface GuideStep {
  id: string;
  title: string;
  instruction: string;
  settleMs?: number;
}
/** One visible target and one real outcome per step, inside the actual sample. */
export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'read-note', title: '补充说明', instruction: '问号里还有一条备注。鼠标停在这里，或点一下，就能展开查看。', settleMs: 900 },
  { id: 'selection', title: '文字排版', instruction: '示例里的文字都能直接编辑。试着拖选这几个字，格式工具会出现在选区旁。' },
  { id: 'highlight', title: '文字高亮', instruction: '彩色 A 可以给选中文字加上背景色。点一下，就能标出这段重点。' },
  { id: 'annotation-open', title: '在文字旁加一条说明', instruction: '选中的文字也可以附上备注。这个问号按钮可以打开说明编辑区。' },
  { id: 'annotation-save', title: '备注、出处或想法', instruction: '都可以写在这里。点击保存或按 Enter，说明就会留在这段文字旁。' },
  { id: 'insert-menu', title: '用 / 找到内容块', instruction: '空行里的 / 可以唤出命令菜单。试试输入 /note，就能找到提示块。' },
  { id: 'insert-callout', title: 'Note 提示块', instruction: 'Note 适合放备注和补充信息。点选这一项或按 Enter，就能插入文档。' },
  { id: 'disclosure', title: '按需展开内容', instruction: '细节较多的内容可以收进折叠块。点一下这里，就能展开这份清单。' },
];
