import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from '@/components/Tooltip';
import { setShortcutOverrides } from '@/core/shortcutBindings';
import { HoverMenuContext } from '@/components/useHoverMenu';
import { ContextualHelpContent } from '@/components/contextualHelp';
import { ALERT_META } from '@/features/editor-md/alertPresentation';
import { IMAGE_TEMPLATES, imageCollectionTemplate } from '@/features/editor-md/rich-content/commands';
import { IMAGE_TEMPLATE_HELP_KEYS } from '@/components/contextualHelpKeys';

let root: Root;
const rich = () => document.querySelector('[data-help-key="block.disclosure"]');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setShortcutOverrides({}); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('mounts an explanation only after sustained hover and releases it on Escape without moving focus', async () => {
  await act(async () => root.render(<TooltipProvider><Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  expect(rich()).toBeNull();
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(640); });
  expect(rich()).toBeNull();
  await act(async () => { vi.advanceTimersByTime(20); });
  expect(rich()).not.toBeNull();
  expect(document.activeElement).toBe(document.body);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(rich()).toBeNull();
});

async function openHelpBesideBlockedTriggers() {
  await act(async () => root.render(<TooltipProvider>
    <Tooltip content="折叠块" helpKey="block.disclosure"><button id="readable-help">折叠块</button></Tooltip>
    <Tooltip content="禁用操作" helpKey="block.callout" disabled><button id="disabled-help">禁用操作</button></Tooltip>
    <Tooltip content={null}><button id="empty-help">空提示入口</button></Tooltip>
  </TooltipProvider>));
  await act(async () => {
    document.querySelector('#readable-help')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(660);
  });
  expect(rich()).not.toBeNull();
  return ['#disabled-help', '#empty-help'].map(selector => document.querySelector<HTMLButtonElement>(selector)!);
}

it('keeps existing rich help visible when blocked triggers receive pointer movement without announcing an open', async () => {
  const triggers = await openHelpBesideBlockedTriggers(), announce = vi.fn();
  document.addEventListener('tooltip.open', announce);
  try {
    for (const trigger of triggers) {
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
        vi.advanceTimersByTime(1000);
      });
      expect(rich()).not.toBeNull();
      expect(document.querySelectorAll('.nb-contextual-help')).toHaveLength(1);
      expect(announce).not.toHaveBeenCalled();
    }
  } finally { document.removeEventListener('tooltip.open', announce); }
});

it('keeps blocked keyboard focus silent while preserving another open help and stable trigger elements', async () => {
  const triggers = await openHelpBesideBlockedTriggers(), announce = vi.fn();
  document.addEventListener('tooltip.open', announce);
  try {
    for (const trigger of triggers) {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        trigger.focus(); vi.advanceTimersByTime(1000);
      });
      expect(document.activeElement).toBe(trigger);
      expect(document.getElementById(trigger.id)).toBe(trigger);
      expect(rich()).not.toBeNull();
      expect(document.querySelectorAll('.nb-contextual-help')).toHaveLength(1);
      expect(announce).not.toHaveBeenCalled();
    }
  } finally { document.removeEventListener('tooltip.open', announce); }
});

it('shows the current custom binding on keyboard focus and hides a removed binding', async () => {
  setShortcutOverrides({ 'markdown.heading1': ['Ctrl+Alt+H'] });
  await act(async () => root.render(<TooltipProvider><Tooltip content="标题 1" shortcut="Ctrl+1"><button>标题 1</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); trigger.focus(); });
  expect(document.querySelector('.nb-tooltip-kbd')?.textContent).toBe('Ctrl + Alt + H');
  expect(document.activeElement).toBe(trigger);
  await act(async () => setShortcutOverrides({ 'markdown.heading1': [] }));
  expect(document.querySelector('.nb-tooltip-kbd')).toBeNull();
});

it('keeps the owning menu alive while reading a portalled explanation and dismisses without focusing it', async () => {
  const cancel = vi.fn(), leave = vi.fn();
  await act(async () => root.render(<TooltipProvider><HoverMenuContext.Provider value={{ cancel, leave }}>
    <Tooltip content="折叠块" helpKey="block.disclosure"><button>折叠块</button></Tooltip>
  </HoverMenuContext.Provider></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(660); });
  const card = document.querySelector('.nb-contextual-help-content')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: card }));
    card.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: trigger }));
  });
  expect(cancel).toHaveBeenCalled(); expect(rich()).not.toBeNull();
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  await act(async () => card.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true); expect(rich()).toBeNull();
  expect(document.activeElement).toBe(document.body);
});

it('uses each real callout preset and distinguishes table captions from image captions', async () => {
  for (const kind of ['note', 'tip', 'important', 'warning', 'caution'] as const) {
    await act(async () => root.render(<ContextualHelpContent helpKey={`block.callout.${kind}`} title={kind}/>));
    const preview = document.querySelector('.github-alert')!;
    expect(preview.getAttribute('data-alert')).toBe(kind);
    expect(preview.querySelector('.alert-title')?.textContent).toBe(ALERT_META[kind].label);
    expect(preview.querySelector('path')?.getAttribute('d')).toBe(ALERT_META[kind].icon);
    expect(preview.querySelector('.alert-body')?.textContent).toBe('');
  }
  await act(async () => root.render(<ContextualHelpContent helpKey="table.caption" title="表注"/>));
  expect(document.querySelector('table > caption .nb-table-caption')?.textContent).toBe('表 1 · 样本统计');
  expect(document.querySelector('figure')).toBeNull();
  await act(async () => root.render(<ContextualHelpContent helpKey="figure.caption" title="图注"/>));
  expect(document.querySelector('figure .nb-image-caption-text')?.textContent).toBe('图 1 · 图片说明');
  expect(document.querySelector('table')).toBeNull();
});

it('shows the empty formula insertion state without fabricating formula content or editable controls', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="formula.block" title="公式块"/>));
  const source = document.querySelector('textarea')!;
  expect(source.value).toBe(''); expect(source.readOnly).toBe(true); expect(source.tabIndex).toBe(-1);
  expect(source.closest('[inert]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('E = mc');
  expect(document.querySelector('.formula-source-hint')?.textContent).toBe('Enter 换行 · Ctrl+Enter 完成');
  await act(async () => root.render(<ContextualHelpContent helpKey="formula.inline" title="行内公式"/>));
  expect(document.querySelector('.formula-source-text')?.textContent).toBe('');
  expect(Array.from(document.querySelectorAll('.formula-source-delimiter'), element => element.textContent)).toEqual(['$', '$']);
});

it('previews the specific whole-table and cell alignment selected by the menu', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="table.position.right" title="整表居右"/>));
  expect(document.querySelector('table')?.style.marginLeft).toBe('auto');
  expect(document.querySelector('table')?.style.marginRight).toBe('0px');
  await act(async () => root.render(<ContextualHelpContent helpKey="table.cell.horizontal.right" title="文字靠右"/>));
  expect(Array.from(document.querySelectorAll('td'), cell => cell.style.textAlign)).toEqual(['right', 'right', 'right']);
  await act(async () => root.render(<ContextualHelpContent helpKey="table.cell.vertical.bottom" title="文字靠下"/>));
  expect(Array.from(document.querySelectorAll('td'), cell => cell.style.verticalAlign)).toEqual(['bottom', 'bottom', 'bottom']);
});

it('shows each image template with the real slot count, column layout, and local image examples', async () => {
  for (const { template, label } of IMAGE_TEMPLATES) {
    const recipe = imageCollectionTemplate(template);
    await act(async () => root.render(<ContextualHelpContent helpKey={IMAGE_TEMPLATE_HELP_KEYS[template]} title={label}/>));
    const preview = document.querySelector('.nb-image-collection')!;
    expect(preview.getAttribute('data-layout')).toBe(recipe.attrs!.layout);
    expect(preview.querySelectorAll('.nb-image-slot')).toHaveLength(recipe.content!.length);
    expect((preview.querySelector('.nb-image-slots') as HTMLElement).style.gridTemplateColumns).toBe(`repeat(${recipe.attrs!.columns},minmax(0,1fr))`);
    expect(Array.from(preview.querySelectorAll('img')).every(image => image.src.startsWith('data:image/svg+xml,'))).toBe(true);
    expect(document.querySelector('.nb-help-preview-label')?.textContent).toBe('添加图片后的效果');
    expect(preview.closest('[inert][aria-hidden="true"]')).not.toBeNull();
    if (template === 'carousel') {
      expect(preview.querySelectorAll('.nb-image-pagination .nb-image-dot')).toHaveLength(3);
      expect(preview.querySelectorAll('.nb-image-dot[aria-pressed="true"]')).toHaveLength(1);
      expect(preview.querySelector('.nb-image-page-previous')?.hasAttribute('disabled')).toBe(true);
      expect(preview.querySelector('.nb-image-counter')?.hasAttribute('hidden')).toBe(true);
    }
  }
});

it('keeps reflow examples distinct from fixed image templates and describes existing content', async () => {
  for (const columns of [2, 3] as const) {
    await act(async () => root.render(<ContextualHelpContent helpKey={`image.collection.columns.${columns}`} title={`${columns}列拼图`}/>));
    expect(document.querySelectorAll('.nb-image-slot')).toHaveLength(6);
    expect((document.querySelector('.nb-image-slots') as HTMLElement).style.gridTemplateColumns).toBe(`repeat(${columns},minmax(0,1fr))`);
    expect(document.querySelector('.nb-contextual-help > p')?.textContent).toContain('保留全部图片和图注');
  }
  await act(async () => root.render(<ContextualHelpContent helpKey="image.collection.layout.carousel" title="图片轮播"/>));
  expect(document.querySelector('.nb-contextual-help > p')?.textContent).toContain('现有图片组合');
  expect(document.querySelector('.nb-contextual-help > p')?.textContent).not.toContain('新建');
});

it('uses real list semantics, task checkboxes, quote and heading elements', async () => {
  for (const [helpKey, tag] of [['list.bullet', 'ul'], ['list.ordered', 'ol']] as const) {
    await act(async () => root.render(<ContextualHelpContent helpKey={helpKey} title="列表"/>));
    expect(document.querySelectorAll(`${tag} > li > p`)).toHaveLength(3);
  }
  await act(async () => root.render(<ContextualHelpContent helpKey="list.task" title="待办"/>));
  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('ul[data-type="taskList"] li[data-type="taskItem"] > label > input[type="checkbox"]'));
  expect(checkboxes.map(input => input.checked)).toEqual([true, false, false]);
  expect(checkboxes.every(input => input.readOnly && input.tabIndex === -1 && input.closest('[inert]'))).toBe(true);
  expect(document.querySelectorAll('li[data-checked="true"] > div > p')).toHaveLength(1);
  await act(async () => root.render(<ContextualHelpContent helpKey="block.quote" title="引用"/>));
  expect(document.querySelector('blockquote > p')?.textContent).toBe('阅读让想法不断生长。');
  await act(async () => root.render(<ContextualHelpContent helpKey="block.heading.3" title="三级标题"/>));
  expect(document.querySelector('h3')?.textContent).toBe('章节标题');
  await act(async () => root.render(<ContextualHelpContent helpKey="block.divider" title="分割线"/>));
  expect(document.querySelector('.nb-help-document > hr')).not.toBeNull();
});

it('shows a static code example with the real language, collapse, wrap and copy controls', async () => {
  await act(async () => root.render(<ContextualHelpContent helpKey="block.code" title="代码块"/>));
  const block = document.querySelector('.nb-code-block')!;
  expect(block.querySelector('.nb-code-block-language > span')?.textContent).toBe('JavaScript');
  expect(block.querySelector('.nb-code-block-heading')?.getAttribute('aria-expanded')).toBe('true');
  expect(block.querySelector('.nb-code-block-icon')?.getAttribute('aria-pressed')).toBe('false');
  expect(block.querySelector('[aria-label="复制代码内容"]')?.textContent).toBe('复制');
  expect(block.querySelectorAll('pre > code > .nb-help-code-line')).toHaveLength(3);
  expect(block.querySelectorAll('.nb-code-line-number')).toHaveLength(3);
  expect(Array.from(block.querySelectorAll('button')).every(button => button.tabIndex === -1 && button.closest('[inert]'))).toBe(true);
});

it('releases the image preview on close and resolves a removed task shortcut without showing a default', async () => {
  await act(async () => root.render(<TooltipProvider><Tooltip content="图片轮播" helpKey="image.collection.carousel"><button>图片轮播</button></Tooltip></TooltipProvider>));
  const trigger = document.querySelector('button')!;
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); vi.advanceTimersByTime(649); });
  expect(document.querySelector('.nb-image-collection')).toBeNull();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(document.querySelector('.nb-image-collection')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('.nb-image-collection')).toBeNull();
  await act(async () => setShortcutOverrides({ 'markdown.taskList': [] }));
  await act(async () => root.render(<TooltipProvider><Tooltip content="待办" helpKey="list.task" shortcut="Ctrl+Shift+9"><button>待办</button></Tooltip></TooltipProvider>));
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); document.querySelector('button')!.focus(); });
  expect(document.querySelector('[data-help-key="list.task"]')).not.toBeNull();
  expect(document.querySelector('.nb-tooltip-kbd')).toBeNull();
});

it('plays the carousel once, synchronizes its real navigation, and leaves no timer after finishing or closing', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await act(async () => root.render(<ContextualHelpContent helpKey="image.collection.carousel" title="图片轮播"/>));
  const selected = () => document.querySelector('.nb-image-dot[aria-pressed="true"]')?.getAttribute('aria-label');
  expect(selected()).toBe('第 1 张图片'); expect(vi.getTimerCount()).toBe(1);
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(selected()).toBe('第 2 张图片');
  expect((document.querySelector('.nb-image-slots') as HTMLElement).style.transform).toBe('translateX(-100%)');
  expect(document.querySelector('.nb-image-counter')?.textContent).toBe('2 / 3');
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(selected()).toBe('第 3 张图片'); expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelector('[aria-label="下一张图片"]')?.hasAttribute('disabled')).toBe(true);
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(selected()).toBe('第 3 张图片');
  await act(async () => root.render(<ContextualHelpContent helpKey="list.task" title="待办"/>));
  await act(async () => root.render(<ContextualHelpContent helpKey="image.collection.carousel" title="图片轮播"/>));
  expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps reduced-motion carousel help static and cancels its pass when the page is hidden', async () => {
  const addEventListener = vi.fn(), removeEventListener = vi.fn();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener, removeEventListener }));
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await act(async () => root.render(<ContextualHelpContent helpKey="image.collection.carousel" title="图片轮播"/>));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(document.querySelector('.nb-image-dot[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('第 1 张图片');
  await act(async () => root.render(null));
  expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener, removeEventListener }));
  await act(async () => root.render(<ContextualHelpContent helpKey="image.collection.carousel" title="图片轮播"/>));
  expect(vi.getTimerCount()).toBe(1);
  hidden.mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(document.querySelector('.nb-image-dot[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('第 1 张图片');
});
