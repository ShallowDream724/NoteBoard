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
  { id: 'read-note', title: '补充说明', instruction: '问号可以展开补充说明。鼠标停在这里，就能看到这份示例的备注。', success: '背景、出处和批注都可以放在这里，随文档一起保存。' },
  { id: 'selection', title: '文字排版', instruction: '示例里的文字都能直接编辑。可以拖选圈中的几个字，看看选区旁的格式工具。', success: '格式工具会作用于这段选中的文字。', autoAdvance: true },
  { id: 'highlight', title: '文字高亮', instruction: '彩色 A 可以给选中文字加上背景色，用来标记重点。点击就能看到效果。', success: '这段文字有了高亮。旁边的菜单还可以更换颜色。', autoAdvance: true },
  { id: 'annotation-open', title: '在原处添加批注', instruction: '选中文字后，还可以附上一条说明。圈出的问号按钮就是入口。', success: '说明编辑区已打开。', autoAdvance: true },
  { id: 'annotation-save', title: '随内容保存的说明', instruction: '这里可以写备注、出处或想法。写好后保存，文字旁就会出现说明标记。', success: '文字旁多了一个问号，以后可以从这里查看或修改这条说明。' },
  { id: 'insert-menu', title: '用 / 找到内容块', instruction: '空行里的 / 可以唤出命令菜单。试试输入 /note，就能找到提示块。', success: '菜单会随输入筛选，/note 对应 Note 提示块。', autoAdvance: true },
  { id: 'insert-callout', title: 'Note 提示块', instruction: 'Note 适合放备注和补充信息。选择这个菜单项，或按 Enter，就能插入。', success: '提示块已经插入，标题、图标和颜色都可以调整。' },
  { id: 'disclosure', title: '按需展开内容', instruction: '细节较多的内容可以收进折叠块。这里的箭头能展开下面这份清单。', success: '再次点击箭头可以收起清单，里面的内容会保留。' },
];
