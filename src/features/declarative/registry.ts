import { isCalloutIcon, isCalloutTitle } from '../editor-md/calloutPresentation';
/** The language catalog is shared by parsing, authoring assistance and AI instructions. */
export interface CommandSpec { name: string; aliases?: readonly string[]; fields: readonly string[]; groups?: number; description: string; example: string; internal?: boolean }
export const inlineCommands: readonly CommandSpec[] = [
  { name: 'b', aliases: ['bold'], fields: [], groups: 1, description: '加粗', example: '\\b{内容}' },
  { name: 'i', aliases: ['italic'], fields: [], groups: 1, description: '斜体', example: '\\i{内容}' },
  { name: 's', aliases: ['strike'], fields: [], groups: 1, description: '删除线', example: '\\s{内容}' },
  { name: 'u', aliases: ['underline'], fields: [], groups: 1, description: '下划线', example: '\\u{内容}' },
  { name: 'blur', fields: [], groups: 1, description: '模糊隐藏', example: '\\blur{答案}' },
  { name: 'color', fields: ['color'], groups: 1, description: '文字颜色', example: '\\color[#2563eb]{内容}' },
  { name: 'bg', fields: ['bg'], groups: 1, description: '文字底色', example: '\\bg[#fef08a]{内容}' },
  { name: 'note', fields: ['ref'], groups: 2, description: '文字说明', example: '\\note{锚点}{说明}' },
  { name: 'native', fields: ['version'], groups: 1, description: '原生行内内容保留', example: '\\native[version=1]{编码内容}', internal: true },
];
export const blockCommands: readonly CommandSpec[] = [
  { name: 'pic', fields: ['grid', 'align', 'width'], description: '图片或宫格', example: '::: pic 2*3 center\n- ![图](image.png)\n:::' },
  { name: 'slide', fields: ['align', 'width', 'print-cols'], description: '图片轮播', example: '::: slide print-cols=2\n- ![图](image.png)\n:::' },
  { name: 'table', fields: ['size', 'align', 'widths'], description: '表格', example: '::: table 2*3\n:::' },
  { name: 'fold', fields: ['title', 'open'], description: '折叠内容', example: '::: fold "详情"\n内容\n:::' },
  ...['note', 'tip', 'important', 'warning', 'caution'].map(name => ({ name, fields: ['title', 'icon', 'bg', 'border'], description: '醒目块', example: `::: ${name}\n内容\n:::` })),
  ...['left', 'center', 'right'].map(name => ({ name, fields: [], description: '内容对齐', example: `::: ${name}\n内容\n:::` })),
  { name: 'bg', fields: ['bg'], description: '块底色', example: '::: bg #eff6ff\n内容\n:::' },
  { name: 'annotation', fields: ['id'], description: '共享说明定义', example: '::: annotation scene\n说明\n:::' },
  { name: 'explain', fields: ['ref'], description: '前一个内容块的说明', example: '::: explain\n说明\n:::' },
  { name: 'native', fields: ['version'], description: '原生内容保留', example: '::: native version=1\n{"type":"paragraph"}\n:::', internal: true },
];
export const authoringRegistry = { inline: inlineCommands, block: blockCommands };
export const definitions = [...inlineCommands.map(spec => ({ ...spec, canonical: spec.name, kind: 'inline' as const, parameters: spec.fields, template: spec.example })), ...blockCommands.map(spec => ({ ...spec, canonical: spec.name, kind: 'block' as const, parameters: spec.fields, template: spec.example }))];
export function commandSpec(name: string, block = false) { return (block ? blockCommands : inlineCommands).find(item => item.name === name.toLowerCase() || item.aliases?.includes(name.toLowerCase())); }
const names: Record<string, string> = { black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080', teal: '#008080' };
export function parseColor(value: string): string | null {
  const text = value.toLowerCase();
  if (names[text]) return names[text];
  if (/^#[0-9a-f]{3,4}$/.test(text)) return '#' + [...text.slice(1)].map(x => x + x).join('');
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(text)) return text;
  const rgb = /^(rgb|rgba)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(0?(?:\.\d+)|0|1(?:\.0+)?)\s*)?\)$/.exec(text);
  if (!rgb || (rgb[1] === 'rgba') !== (rgb[5] !== undefined) || rgb.slice(2, 5).some(x => Number(x) > 255)) return null;
  return '#' + rgb.slice(2, 5).map(x => Number(x).toString(16).padStart(2, '0')).join('') + (rgb[5] === undefined ? '' : Math.round(Number(rgb[5]) * 255).toString(16).padStart(2, '0'));
}
export const alignment = (text: string): string | null => ({ l: 'left', m: 'center', r: 'right', centre: 'center', middle: 'center', left: 'left', center: 'center', right: 'right' })[text.toLowerCase()] ?? null;

export function parseParameters(name: string, source: string, block: boolean): { values: Record<string, unknown>; error?: string } {
  const spec = commandSpec(name, block), values: Record<string, unknown> = {};
  if (!spec) return { values, error: `未知命令 ${name}` };
  name = spec.name;
  const tokens: string[] = []; let start = 0, quote = false, depth = 0, escaped = false;
  for (let i = 0; i <= source.length; i++) {
    const c = source[i];
    if (quote) { if (c === '"' && !escaped) quote = false; escaped = c === '\\' && !escaped; continue; }
    if (c === '"') quote = true;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (i === source.length || (/\s/.test(c) && !depth && !quote)) { const part = source.slice(start, i).trim(); if (part) tokens.push(part); start = i + 1; }
  }
  if (quote || depth || /[\r\n]/.test(source)) return { values, error: '参数必须在一行内闭合' };
  // Whitespace around = belongs to the same assignment.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '=' && i > 0 && i + 1 < tokens.length) { tokens.splice(i - 1, 3, tokens[i - 1] + '=' + tokens[i + 1]); i--; }
    else if (tokens[i].endsWith('=') && i + 1 < tokens.length) tokens.splice(i, 2, tokens[i] + tokens[i + 1]);
    else if (tokens[i].startsWith('=') && i > 0) { tokens.splice(i - 1, 2, tokens[i - 1] + tokens[i]); i--; }
  }
  for (const token of tokens) {
    const assignment = /^([a-z][a-z0-9-]*)=(.*)$/i.exec(token); let key = assignment?.[1].toLowerCase(), raw = assignment?.[2] ?? token;
    if (!key) {
      if (name === 'annotation') key = 'id';
      else if (alignment(raw)) key = 'align';
      else if (/^\d+[*x×]\d+$/.test(raw)) key = name === 'table' ? 'size' : 'grid';
      else if (/^\d+(?:\.\d+)?%$/.test(raw)) key = 'width';
      else if (raw.startsWith('"')) key = 'title';
      else if (name === 'fold' && raw.toLowerCase() === 'open') { key = 'open'; raw = 'true'; }
      else if (name === 'color' || name === 'bg') key = name;
    }
    if (!key || !spec.fields.includes(key)) return { values, error: `未知参数 ${token}` };
    let value: unknown = raw;
    if (raw.startsWith('"')) {
      for (let i = 1; i < raw.length - 1; i++) if (raw[i] === '\\') { if (!['"', '\\'].includes(raw[++i])) return { values, error: '字符串只支持双引号和反斜杠转义' }; }
      try { value = JSON.parse(raw); } catch { return { values, error: '引号字符串无效' }; }
      if (['open', 'version', 'print-cols', 'widths', 'size', 'grid'].includes(key)) return { values, error: `${key}的值类型无效` };
    }
    if (['color', 'bg', 'border'].includes(key)) { value = parseColor(String(value)); if (!value) return { values, error: `无效颜色 ${raw}` }; }
    if (key === 'align') { value = alignment(String(value)); if (!value) return { values, error: '无效对齐方向' }; }
    if (key === 'grid' || key === 'size') { const match = /^(\d+)[*x×](\d+)$/.exec(String(value)); if (!match || !Number(match[1]) || !Number(match[2]) || Number(match[1]) * Number(match[2]) > 10000) return { values, error: '无效尺寸' }; value = [Number(match[1]), Number(match[2])]; }
    if (key === 'width' && (!/^\d+(?:\.\d+)?%$/.test(String(value)) || parseFloat(String(value)) <= 0 || parseFloat(String(value)) > 100)) return { values, error: '宽度必须大于0且不超过100%' };
    if (key === 'open') { if (value !== 'true' && value !== 'false') return { values, error: 'open必须为布尔值' }; value = value === 'true'; }
    if (key === 'print-cols' || key === 'version') { value = Number(value); if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 200) return { values, error: '必须是正整数' }; }
    if (key === 'widths') { try { value = JSON.parse(String(value)); } catch { return { values, error: '无效列宽列表' }; } if (!Array.isArray(value) || !value.length || !value.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)) return { values, error: '列宽必须为正数列表' }; }
    if (['ref', 'id'].includes(key) && !/^[a-zA-Z0-9_-]{1,128}$/.test(String(value))) return { values, error: '无效说明名称' };
    if (key === 'icon' && !isCalloutIcon(value)) return { values, error: '无效图标，应使用已登记名称或单个emoji' };
    if (key === 'title' && ['note', 'tip', 'important', 'warning', 'caution'].includes(name) && !isCalloutTitle(value)) return { values, error: '标题必须为不超过500字符的单行纯文本' };
    if (key in values && JSON.stringify(values[key]) !== JSON.stringify(value)) return { values, error: `冲突参数 ${key}` };
    values[key] = value;
  }
  if ((name === 'color' || name === 'bg') && !values[name]) return { values, error: '缺少颜色' };
  if (name === 'fold' && (typeof values.title !== 'string' || !values.title.trim())) return { values, error: '折叠块需要非空标题' };
  if (name === 'annotation' && !values.id) return { values, error: '缺少说明名称' };
  return { values };
}
