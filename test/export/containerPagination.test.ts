import { afterEach, expect, it, vi } from 'vitest';
import { fitPageImages, updateContainerPagination } from '../../src/features/export/containerPagination';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(html: string) { const root = document.createElement('article'); root.innerHTML = html; document.body.append(root); return root; }
function height(element: Element, value: number) { return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, value)); }

it('keeps short containers and media, allows large prose and continued formulas to paginate', () => {
  const root = fixture('<div class="github-alert"></div><details class="export-disclosure"></details><pre></pre><figure data-nb-image></figure><div class="export-math display wrap"></div><div class="export-math display" data-math-continued></div><table></table>');
  [80, 600, 1500, 900, 900, 900, 80].forEach((value, index) => height(root.children[index], value));
  updateContainerPagination(root, 1000);
  expect(Array.from(root.children, element => element.getAttribute('data-export-pagination'))).toEqual(['keep', 'split', 'split', 'keep', 'keep', 'split', null]);
  updateContainerPagination(root, 1400);
  expect(root.querySelector('details')?.dataset.exportPagination).toBe('keep');
});

it('rechecks only the changed item, descendants and its containing boxes', () => {
  const root = fixture('<div class="github-alert"><div class="export-math display"></div></div><div class="github-alert"></div>');
  const reads = Array.from(root.querySelectorAll<HTMLElement>('div'), element => height(element, 40));
  updateContainerPagination(root, 1000, [root.querySelector('.export-math')!]);
  expect(reads.map(read => read.mock.calls.length)).toEqual([1, 1, 0]);
});

it('reserves room for a caption without shrinking an image for a page-long caption', () => {
  const root = fixture('<figure data-nb-image><img><figcaption>Caption</figcaption></figure><figure class="export-image-slot"><figure data-nb-image><img></figure><p>Grid caption</p></figure><figure data-nb-image><img><figcaption>Very long caption</figcaption></figure>');
  const images = Array.from(root.querySelectorAll('img'));
  const owners = [root.children[0], root.children[1], root.children[2]];
  images.forEach(image => height(image, 1000));
  [1040, 1070, 1700].forEach((value, index) => height(owners[index], value));
  fitPageImages(root, 1000);
  expect(images.map(image => image.style.maxHeight)).toEqual(['958px', '928px', '1000px']);
  fitPageImages(root, 1400);
  expect(images.map(image => image.style.maxHeight)).toEqual(['1358px', '1328px', '698px']);
});

it('leaves room for enclosing container padding instead of overflowing a decorated continuation', () => {
  const root = fixture('<div class="github-alert" style="padding:20px;border:1px solid"><figure data-nb-image><img><figcaption>Caption</figcaption></figure></div>');
  const image = root.querySelector('img')!;
  height(image, 1000); height(root.querySelector('figure')!, 1040);
  fitPageImages(root, 1000);
  expect(image.style.maxHeight).toBe('916px');
});
