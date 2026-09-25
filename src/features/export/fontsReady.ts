/** CSS font faces become loading only after the newly inserted document has
 * participated in layout. Reading fonts.ready before that can return the old,
 * already-resolved promise and print fallback metrics on a cold font cache. */
export async function waitForExportFonts(root: HTMLElement): Promise<void> {
  root.getBoundingClientRect();
  await document.fonts.ready;
  const failed = [...document.fonts].filter(face => face.status === 'error');
  if (failed.length) {
    const families = [...new Set(failed.map(face => face.family.replace(/^['"]|['"]$/g, '')))];
    throw new Error(`无法加载打印字体：${families.join('、')}。请检查字体设置后重试。`);
  }
}
