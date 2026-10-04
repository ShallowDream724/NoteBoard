import { encodeNativeDocument, type NativeNode } from '../../core/nativeDocument';

export const PRACTICE_WORD = '观察与记录';
export const PRACTICE_TITLE = '周末公园观察';
export const OBSERVATION_BLOCK = '观察结论：树荫下比开阔草地更凉爽。';
export const ACTION_BLOCK = '行动建议：下次带上温度计，比较不同位置。';
export interface PracticeTask {
  id: string;
  group: string;
  title: string;
  instruction: string;
  hint: string;
  target?: string;
}
export const PRACTICE_TASKS: readonly PracticeTask[] = [
  { id: 'selection', group: '文字与结构', title: '选中一段文字', instruction: '在正文中选中“观察与记录”这几个字。', hint: '拖动鼠标选择文字，或用 Shift + 方向键调整选区。', target: PRACTICE_WORD },
  { id: 'highlight', group: '文字与结构', title: '给文字加高亮', instruction: '给“观察与记录”添加背景高亮。', hint: '选中文字后，使用浮动工具栏或顶部的高亮颜色控件，选择一种背景色。', target: PRACTICE_WORD },
  { id: 'heading', group: '文字与结构', title: '设置小标题', instruction: '将“周末公园观察”这一行设为二级标题。', hint: '将光标放入这一行，使用工具栏的标题菜单选择“二级标题（H2）”。', target: PRACTICE_TITLE },
  { id: 'callout', group: '丰富内容', title: '插入提示块', instruction: '插入一个提示块，并在里面写下“记得带水”。', hint: '在空白行使用插入菜单或工具栏的提示块入口，再点击块内输入。', target: '路线与准备' },
  { id: 'disclosure', group: '丰富内容', title: '收起一份清单', instruction: '插入折叠块，将标题改为“装备清单”，在里面填写一件要带的物品。', hint: '插入折叠块后可以直接编辑它的标题；展开后在正文填写物品。', target: '路线与准备' },
  { id: 'table', group: '丰富内容', title: '插入并填写表格', instruction: '插入至少两行两列的表格，第一行填入“项目”和“记录”，再填入一项观察。', hint: '使用表格插入菜单选择尺寸。点击单元格输入，Tab 可以移到下一个单元格。', target: '观察数据' },
  { id: 'table-style', group: '丰富内容', title: '试试三线表', instruction: '把刚才的表格切换成三线表样式。', hint: '在表格内打开表格外观菜单，选择“三线表”。', target: '观察数据' },
  { id: 'formula', group: '丰富内容', title: '输入行内公式', instruction: '插入行内公式，输入 x^2+y^2=r^2。', hint: '使用工具栏的行内公式入口，在公式输入框填写后确认。', target: '形状与距离' },
  { id: 'annotation', group: '整理与回退', title: '补充一条说明', instruction: '给“观察与记录”添加补充说明，写下一句解释。', hint: '选中文字后选择“添加说明”，填写正文并保存；也可以给它所在的整块添加说明。', target: PRACTICE_WORD },
  { id: 'move', group: '整理与回退', title: '调整块的顺序', instruction: '将“行动建议”这一整块移动到“观察结论”前面。', hint: '将鼠标移到块左侧，拖动块手柄调整顺序；也可以剪切整块后粘贴到新位置。', target: ACTION_BLOCK },
  { id: 'history', group: '整理与回退', title: '撤销，再重做', instruction: '先在正文做一次小修改，然后撤销，再重做，让修改恢复。', hint: '可使用工具栏的撤销与重做，或 Ctrl + Z、Ctrl + Shift + Z。', target: '下一次出发' },
];

const paragraph = (text = ''): NativeNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
/** Ordinary editable material. Instructions live exclusively in the task card. */
export function createPracticeContent(): string {
  return encodeNativeDocument({ type: 'doc', content: [
    paragraph(PRACTICE_TITLE),
    paragraph('一次散步，也可以成为一份有趣的笔记。观察与记录帮助我们发现身边的小变化。'),
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '路线与准备' }] },
    paragraph('从南门进入，沿湖边小路走到草地，在树荫下停留片刻。'), paragraph(),
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '观察数据' }] },
    paragraph('记录天气、位置和看到的现象，留作下一次比较。'), paragraph(),
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '形状与距离' }] },
    paragraph('圆形花坛让人想到半径与距离之间的关系。'), paragraph(),
    paragraph(OBSERVATION_BLOCK), paragraph(ACTION_BLOCK),
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '下一次出发' }] },
    paragraph('期待下一次散步。'), paragraph(),
  ] });
}
