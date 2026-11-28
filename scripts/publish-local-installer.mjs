// node scripts/publish-local-installer.mjs <built NSIS installer> <local output directory>
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected the installer and its local output directory');
const installer = resolve(input), out = resolve(output), name = basename(installer);
const versioned = /^NoteBoard_\d+\.\d+\.\d+(?:-[\w.-]+)?_x64-setup\.exe$/i;
if (!versioned.test(name) || dirname(installer) === out) throw new Error('Expected a separate NoteBoard NSIS build');
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const current = 'NoteBoard-current-setup.exe', previous = 'NoteBoard-previous-setup.exe';
await mkdir(out, { recursive: true });
const entries = (await readdir(out, { withFileTypes: true })).filter(entry => entry.isFile()
  && (versioned.test(entry.name) || entry.name === current || entry.name === previous));
const old = await Promise.all(entries.map(async ({ name }) => ({
  name, path: join(out, name), time: (await lstat(join(out, name))).mtimeMs,
})));
const digest = await hash(installer);
// The published current build takes precedence over OS copy timestamps.
old.sort((a, b) => Number(b.name === current) - Number(a.name === current) || b.time - a.time);
const stage = await mkdtemp(join(out, '.publish-noteboard-'));
try {
  for (const entry of old) {
    if (await hash(entry.path) === digest) continue;
    if (entry.name !== previous) {
      await copyFile(entry.path, join(stage, previous));
      await rename(join(stage, previous), join(out, previous));
    }
    break;
  }
  await copyFile(installer, join(stage, name));
  if (await hash(join(stage, name)) !== digest) throw new Error('Installer copy verification failed');
  await link(join(stage, name), join(stage, current));
  await rename(join(stage, name), join(out, name));
  await rename(join(stage, current), join(out, current));
  await writeFile(join(out, 'SHA256SUMS.txt'), digest + '  ' + name + '\n');
  for (const entry of old) {
    if (versioned.test(entry.name) && entry.name !== name) await unlink(entry.path);
  }
  console.log(name, digest);
} finally {
  for (const file of await readdir(stage)) await unlink(join(stage, file));
  await rmdir(stage);
}
