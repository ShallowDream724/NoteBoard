import { describe, expect, it, vi } from 'vitest';
import { prepareImageSources } from '@/features/editor-md/imageAssetSource';
const data = 'data:image/png;base64,YQ==';
const transient = `C:/recovery/.noteboard-assets/${'a'.repeat(64)}.png`;
describe('image source materialization', () => {
  it('rewrites only semantic images and resolves duplicate NB sources once', async () => {
    const image = { type: 'image', attrs: { src: data } };
    const source = `#!noteboard 1\r\n@meta {"custom":{"source":"${data}"}}\r\n@block ${JSON.stringify({ type: 'paragraph', content: [{ type: 'text', text: data }] })}\r\n@block ${JSON.stringify({ type: 'disclosure', content: [image, image] })}\r\n@block broken ${data}\r\n`;
    const resolve = vi.fn().mockResolvedValue('./img/a.png');
    const result = await prepareImageSources(source, 'noteboard', resolve);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(data);
    expect(result.content).toContain(`"source":"${data}"`);
    expect(result.content).toContain(`"text":"${data}"`);
    expect(result.content.match(/\.\/img\/a\.png/g)).toHaveLength(2);
    expect(result.content).toContain(`@block broken ${data}\r\n`);
    expect(result.content.replace(/\r\n/g, '')).not.toContain('\n');
  });
  it('preserves Markdown bytes outside inline, reference, and HTML image destinations', async () => {
    const source = `# Heading  \n\n![a](<${transient}>)\n\n![b][photo]\n\n[photo]: ${data} "caption"\n\n<img alt="x" src="${data}" />\n\n\`![code](${data})\`\n\n\`\`\`html\n<img src="${data}"/>\n\`\`\`\n\n[text](${data})\n`;
    const resolve = vi.fn().mockResolvedValue('./img/a.png');
    const result = await prepareImageSources(source, 'markdown', resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.content).toContain('![a](<./img/a.png>)');
    expect(result.content).toContain('[photo]: ./img/a.png "caption"');
    expect(result.content).toContain('<img alt="x" src="./img/a.png" />');
    expect(result.content).toContain(`\`![code](${data})\``);
    expect(result.content).toContain(`\`\`\`html\n<img src="${data}"/>\n\`\`\``);
    expect(result.content).toContain(`[text](${data})`);
    expect(result.content.startsWith('# Heading  \n\n')).toBe(true);
  });
  it('leaves existing local, missing, remote and error-frame images untouched', async () => {
    const source = '#!noteboard 1\n' + ['./img/missing.png', 'C:/elsewhere/image.png', 'https://example.test/image.png', `./.noteboard-assets/${'a'.repeat(64)}.png`].map(src => `@block ${JSON.stringify({ type: 'image', attrs: { src } })}\n`).join('');
    const resolve = vi.fn();
    expect((await prepareImageSources(source, 'noteboard', resolve)).content).toBe(source);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('finds actual HTML src attributes and collapsed references without touching comments or quoted examples', async () => {
    const source = `![photo][]\n\n[photo]: ${data}\n\n<img data-src="preview.png" alt='x > src="${data}"' src="${data}" />\n\n<img data-src="${data}" src="plain.png">\n\n<!-- <img src="${data}"> -->\n\n<script>const sample = '<img src="${data}">';</script>\n`;
    const result = await prepareImageSources(source, 'markdown', async () => './my images/a.png');
    expect(result.content).toContain('[photo]: <./my images/a.png>');
    expect(result.content).toContain(`alt='x > src="${data}"' src="./my images/a.png"`);
    expect(result.content).toContain(`<img data-src="${data}" src="plain.png">`);
    expect(result.content).toContain(`<!-- <img src="${data}"> -->`);
    expect(result.content).toContain(`<script>const sample = '<img src="${data}">';</script>`);
    expect((await prepareImageSources(`<img src=${transient}>`, 'markdown', async () => './my images/a.png')).content).toBe('<img src="./my images/a.png">');
  });
  it('rejects a missing transient resource without returning a partly rewritten document', async () => {
    const source = `#!noteboard 1\n@block {"type":"image","attrs":{"src":"${transient}"}}\n`;
    await expect(prepareImageSources(source, 'noteboard', async () => { throw new Error('missing asset'); })).rejects.toThrow('missing asset');
  });
});
