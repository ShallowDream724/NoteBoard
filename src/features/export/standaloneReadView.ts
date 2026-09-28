import { getCodeLanguage, normalizeLanguage } from '../../core/codeLanguages';

function button(label: string, action: string, text = label) {
  const element = document.createElement('button');
  element.type = 'button'; element.setAttribute('aria-label', label);
  element.setAttribute(action, ''); element.textContent = text;
  return element;
}

/** Static read-view markup only. The exported page never mounts an editor. */
export function enhanceStandaloneReadView(root: HTMLElement) {
  for (const pre of root.querySelectorAll<HTMLElement>('pre')) {
    const code = pre.querySelector<HTMLElement>(':scope > code');
    if (!code) continue;
    const language = normalizeLanguage([...code.classList].find(name => name.startsWith('language-'))?.slice(9) ?? '');
    const block = document.createElement('div'); block.className = 'export-code-block';
    const toolbar = document.createElement('div'); toolbar.className = 'export-code-toolbar';
    const label = document.createElement('span'); label.className = 'export-code-language';
    label.textContent = getCodeLanguage(language)?.label ?? language;
    const toggle = button('折叠代码块', 'data-code-collapse', '⌄'); toggle.setAttribute('aria-expanded', 'true');
    const actions = document.createElement('span'); actions.className = 'export-code-actions';
    const wrap = button('自动换行', 'data-code-wrap', '换行'); wrap.setAttribute('aria-pressed', 'false');
    const copy = button('复制代码内容', 'data-code-copy', '复制');
    const status = document.createElement('span'); status.className = 'export-sr-only'; status.setAttribute('role', 'status');
    actions.append(wrap, copy, status); toolbar.append(toggle, label, actions);
    pre.replaceWith(block); block.append(toolbar, pre);
    block.dataset.codeLanguage = language;
    if (pre.dataset.annotationId) {
      block.dataset.annotationId = pre.dataset.annotationId; block.dataset.annotationBlock = '';
      pre.removeAttribute('data-annotation-id');
    }
  }
  for (const anchor of root.querySelectorAll<HTMLElement>('[data-annotation-id]')) {
    const id = anchor.dataset.annotationId!;
    const inline = anchor.matches('span.nb-annotation-anchor');
    const trigger = inline ? anchor : button('补充说明', 'data-export-annotation', '?');
    trigger.dataset.exportAnnotation = id;
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'export-annotation-panel');
    if (inline) { trigger.setAttribute('role', 'button'); trigger.tabIndex = 0; }
    else {
      trigger.className = 'export-annotation-indicator';
      if (anchor.matches('.export-code-block')) anchor.querySelector('.export-code-actions')!.prepend(trigger);
      else if (anchor.matches('p,h1,h2,h3,h4,h5,h6')) { anchor.classList.add('export-annotation-text'); anchor.append(trigger); }
      else {
        const marker = document.createElement('div'); marker.className = 'export-annotation-block-marker'; marker.append(trigger);
        const host = anchor.closest('.export-table-scroll') ?? anchor;
        host.before(marker);
      }
    }
  }
  // A source can contain an unreferenced body. Keep it readable instead of
  // silently hiding it behind an anchor that no longer exists.
  const referenced = new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-export-annotation]'), anchor => anchor.dataset.exportAnnotation));
  const orphans = Array.from(root.querySelectorAll<HTMLElement>('[data-annotation-body]')).filter(body => !referenced.has(body.dataset.annotationBody));
  if (orphans.length) {
    const section = document.createElement('section'); section.className = 'export-annotations';
    const heading = document.createElement('h2'); heading.textContent = '补充说明';
    section.append(heading, ...orphans); root.append(section);
  }
}
