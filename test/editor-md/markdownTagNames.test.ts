import { expect, it } from 'vitest';
import { parseMarkdownDocument } from '../../src/features/editor-md/documentExtensions';

it('parses Markdown next to literal tag names containing underscores', () => {
  const doc = parseMarkdownDocument([
    '<project_authorizations>',
    '- read `config.md`',
    '</project_authorizations>',
    '',
    '<paramount_rules>**keep**</paramount_rules>',
  ].join('\n'));
  expect(doc.child(0).textContent).toBe('<project_authorizations>');
  expect(doc.child(1).type.name).toBe('bulletList');
  const item = doc.child(1).firstChild!.firstChild!;
  expect(item.child(1).text).toBe('config.md');
  expect(item.child(1).marks.map(mark => mark.type.name)).toEqual(['code']);
  expect(item.textContent).toContain('</project_authorizations>');
  const inline = doc.child(2);
  expect(inline.textContent).toBe('<paramount_rules>keep</paramount_rules>');
  expect(inline.child(1).marks.map(mark => mark.type.name)).toEqual(['bold']);
});

it('allows underscores in HTML attributes and keeps valid HTML tag names', () => {
  const doc = parseMarkdownDocument('<table data_name="one"><tr><td>A</td></tr></table>\n\nUse <em data_name="two">B</em>.');
  expect(doc.child(0).type.name).toBe('table');
  expect(doc.child(0).textContent).toBe('A');
  expect(doc.child(1).child(1).marks.map(mark => mark.type.name)).toEqual(['italic']);
});
