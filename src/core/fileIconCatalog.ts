/** Presentation metadata only. Document support and save policy remain in docKind.
 * Tables are finite and shared; resolving a path never retains that path. */
export type FileIconTone = 'gray' | 'red' | 'vermilion' | 'orange' | 'yellow'
  | 'green' | 'mint' | 'teal' | 'cyan' | 'blue' | 'indigo' | 'purple' | 'pink' | 'brown';

export interface FileIconDescriptor {
  readonly symbol: string;
  readonly tone: FileIconTone;
  readonly secondaryTone?: FileIconTone;
  readonly native?: true;
}

function icon(symbol: string, tone: FileIconTone = 'gray', native?: true, secondaryTone?: FileIconTone): FileIconDescriptor {
  return Object.freeze({ symbol, tone, ...(native && { native }), ...(secondaryTone && { secondaryTone }) });
}

export const FILE_ICONS = Object.freeze({
  file: icon('file-duo'), text: icon('file-text-duo'), folder: icon('folder-duo', 'orange'),
  folderOpen: icon('folder-open-duo', 'orange'), markdown: icon('lang-markdown', 'green'),
  image: icon('image-duo', 'pink'), svg: icon('svg-2', 'orange'),
  javascript: icon('lang-javascript-duo', 'yellow'), typescript: icon('lang-typescript-duo', 'blue'),
  react: icon('react', 'cyan'), html: icon('lang-html-duo', 'orange'), css: icon('lang-css-duo', 'indigo'),
  json: icon('braces', 'orange'), yaml: icon('yml', 'red'), xml: icon('code', 'vermilion'),
  code: icon('code-block-duo', 'blue'), config: icon('gear'), database: icon('server-duo', 'blue'),
  table: icon('file-table-duo', 'green'), archive: icon('folder-zip-duo', 'purple'), font: icon('font', 'purple'),
  c: icon('lang-c', 'blue'), csharp: icon('lang-c', 'purple'), python: icon('lang-python', 'blue', undefined, 'yellow'),
  ruby: icon('lang-ruby', 'red'), rust: icon('lang-rust', 'orange'), go: icon('lang-go', 'cyan'),
  swift: icon('lang-swift', 'orange'), shell: icon('bash-duo'),
  git: icon('git', 'vermilion'), npm: icon('npm-duo', 'red'), docker: icon('docker', 'blue'),
  astro: icon('astro', 'purple', undefined, 'pink'), babel: icon('babel', 'yellow'), biome: icon('biome', 'blue'),
  bootstrap: icon('bootstrap-duo', 'indigo'), browserslist: icon('browserslist-duo', 'yellow'),
  bun: icon('bun', 'brown'), claude: icon('claude', 'orange'), eslint: icon('eslint', 'indigo'),
  graphql: icon('graphql', 'pink'), mcp: icon('mcp', 'purple'), nextjs: icon('nextjs'),
  oxc: icon('oxc', 'cyan'), postcss: icon('postcss', 'red'), prettier: icon('prettier', 'teal'),
  sass: icon('sass', 'pink'), stylelint: icon('stylelint'), svelte: icon('svelte', 'red'),
  svgo: icon('svgo', 'green'), tailwind: icon('tailwind', 'cyan'), terraform: icon('terraform', 'indigo'),
  vite: icon('vite', 'purple'), vscode: icon('vscode', 'blue'), vue: icon('vue', 'green'),
  wasm: icon('wasm-duo', 'indigo'), webpack: icon('webpack', 'blue', undefined, 'cyan'), zig: icon('zig', 'orange'),
  rss: icon('rss', 'orange'), application: icon('extension', 'blue'),
  noteboard: icon('noteboard', 'indigo', true), board: icon('board', 'purple', true),
  mindmap: icon('mindmap', 'orange', true), drawio: icon('flowchart', 'vermilion', true),
  bitable: icon('bitable', 'blue', true), mermaid: icon('flowchart', 'teal', true),
  infographic: icon('infographic', 'mint', true), plantuml: icon('mindmap', 'purple', true),
  pdf: icon('document', 'red', true), document: icon('document', 'blue', true),
  presentation: icon('presentation', 'orange', true), tex: icon('formula', 'teal', true),
  ebook: icon('book', 'purple', true), audio: icon('audio', 'pink', true), video: icon('video', 'purple', true),
  design: icon('design', 'pink', true), model: icon('model', 'teal', true),
});

type IconKind = keyof typeof FILE_ICONS;
type Rule = readonly [IconKind, readonly string[]];

const extensionRules: readonly Rule[] = [
  ['noteboard', ['nb', 'nbdoc']], ['markdown', ['md', 'markdown', 'mdx', 'mdown', 'mkd', 'qmd', 'rmd']],
  ['board', ['board', 'canvas', 'excalidraw']], ['mindmap', ['mindmap', 'xmind', 'mm', 'opml']],
  ['drawio', ['drawio', 'dio']], ['bitable', ['bitable', 'table']],
  ['mermaid', ['mmd', 'mermaid']], ['infographic', ['infographic', 'ig']],
  ['plantuml', ['puml', 'plantuml', 'iuml', 'uml']],
  ['image', ['png', 'jpg', 'jpeg', 'jpe', 'jfif', 'bmp', 'dib', 'gif', 'apng', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'ico', 'icns', 'cur', 'dng', 'raw', 'cr2', 'nef']],
  ['svg', ['svg', 'svgz']], ['design', ['psd', 'psb', 'ai', 'eps', 'sketch', 'fig', 'afdesign', 'afphoto', 'xcf', 'kra', 'procreate']],
  ['pdf', ['pdf']], ['document', ['doc', 'docx', 'docm', 'odt', 'rtf', 'pages', 'wpd']],
  ['presentation', ['ppt', 'pptx', 'pptm', 'odp', 'key']], ['ebook', ['epub', 'mobi', 'azw', 'azw3', 'fb2']],
  ['tex', ['tex', 'sty', 'bib', 'cls', 'dtx', 'ltx']],
  ['audio', ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'opus', 'm4a', 'aiff', 'aif', 'wma', 'mid', 'midi', 'amr']],
  ['video', ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', '3gp']],
  ['model', ['obj', 'stl', 'fbx', 'gltf', 'glb', 'blend', 'ply', '3ds', 'dae', 'usd', 'usdz', 'step', 'stp', 'iges', 'igs']],
  ['font', ['ttf', 'otf', 'woff', 'woff2', 'eot', 'ttc']],
  ['database', ['sql', 'db', 'db3', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'duckdb']],
  ['table', ['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'numbers', 'parquet', 'arrow', 'feather']],
  ['json', ['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'geojson', 'ipynb']],
  ['yaml', ['yaml', 'yml']], ['xml', ['xml', 'xsd', 'xsl', 'xslt', 'plist', 'xaml', 'wsdl']], ['rss', ['rss', 'atom']],
  ['html', ['html', 'htm', 'xhtml']], ['css', ['css', 'less', 'postcss', 'styl', 'stylus']], ['sass', ['scss', 'sass']],
  ['javascript', ['js', 'mjs', 'cjs']], ['typescript', ['ts', 'mts', 'cts']], ['react', ['jsx', 'tsx']],
  ['python', ['py', 'pyw', 'pyi', 'pyx', 'pxd']], ['go', ['go']], ['rust', ['rs']],
  ['ruby', ['rb', 'erb', 'gemspec', 'rake']], ['swift', ['swift']], ['csharp', ['cs', 'csx']],
  ['c', ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'inl', 'm']],
  ['code', ['java', 'class', 'kt', 'kts', 'scala', 'sc', 'php', 'phtml', 'rbw', 'pl', 'pm', 'r', 'jl', 'lua', 'dart', 'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'clj', 'cljs', 'cljc', 'edn', 'fs', 'fsx', 'vb', 'vbs', 'pas', 'pp', 'd', 'nim', 'v', 'sol', 'move', 'asm', 's', 'f', 'f90', 'f95', 'cob', 'coffee', 'pug', 'hbs', 'ejs', 'njk', 'liquid', 'proto', 'prisma', 'cmake', 'gradle', 'groovy']],
  ['shell', ['sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'nu']],
  ['config', ['ini', 'conf', 'config', 'cfg', 'env', 'properties', 'toml', 'hcl', 'lock', 'service', 'desktop', 'reg']],
  ['text', ['txt', 'text', 'log', 'rst', 'adoc', 'asciidoc', 'org', 'srt', 'vtt', 'ass', 'ssa', 'lrc', 'sum', 'sha256', 'sha512', 'sha1', 'md5']],
  ['archive', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'zst', 'lz', 'lzma', 'cab', 'iso', 'img', 'dmg', 'vhd', 'vhdx', 'qcow2']],
  ['application', ['exe', 'msi', 'msix', 'appx', 'apk', 'aab', 'app', 'deb', 'rpm', 'appimage', 'dll', 'so', 'dylib']],
  ['astro', ['astro']], ['graphql', ['graphql', 'gql']], ['svelte', ['svelte']], ['vue', ['vue']],
  ['terraform', ['tf', 'tfvars', 'tfstate']], ['wasm', ['wasm', 'wat', 'wast']],
  ['vscode', ['code-workspace']], ['zig', ['zig']], ['mcp', ['mcp']],
];

const filenameRules: readonly Rule[] = [
  ['docker', ['dockerfile', 'containerfile', '.dockerignore', 'docker-compose.yml', 'docker-compose.yaml', 'docker-compose.override.yml', 'compose.yml', 'compose.yaml']],
  ['git', ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', '.gitconfig']],
  ['npm', ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', '.npmignore']],
  ['go', ['go.mod', 'go.sum', 'go.work', 'go.work.sum']], ['rust', ['cargo.toml', 'cargo.lock', 'rust-toolchain.toml']],
  ['ruby', ['gemfile', 'gemfile.lock', 'rakefile']], ['shell', ['.bashrc', '.bash_profile', '.zshrc', '.zshenv', '.zprofile', '.profile']],
  ['text', ['readme', 'license', 'licence', 'copying', 'notice', 'authors', 'changelog', 'changes', 'todo']],
  ['config', ['.env', '.editorconfig', 'makefile', 'gnumakefile', 'cmakelists.txt', 'justfile', '.yarnrc', '.yarnrc.yml']],
  ['bun', ['bunfig.toml', 'bun.lockb', 'bun.lock']], ['biome', ['biome.json', 'biome.jsonc']],
  ['browserslist', ['.browserslistrc']], ['claude', ['claude.md']], ['oxc', ['.oxlintrc.json']],
  ['terraform', ['.terraform.lock.hcl']],
];

// A finite suffix set avoids fuzzy substring matches: mydockerfile.txt stays text.
const configFamilies: readonly [IconKind, readonly string[]][] = [
  ['eslint', ['eslint.config', '.eslintrc', '.eslintignore']],
  ['prettier', ['prettier.config', '.prettierrc', '.prettierignore']],
  ['stylelint', ['stylelint.config', '.stylelintrc', '.stylelintignore']],
  ['vite', ['vite.config']], ['svgo', ['svgo.config']], ['babel', ['babel.config', '.babelrc']],
  ['tailwind', ['tailwind.config']], ['nextjs', ['next.config']], ['webpack', ['webpack.config']],
  ['postcss', ['postcss.config', '.postcssrc']], ['bootstrap', ['bootstrap', 'bootstrap.min', 'bootstrap.bundle', 'bootstrap.bundle.min']],
];
const configSuffixes = ['', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.json', '.yaml', '.yml', '.toml', '.css', '.babel.js'];

function table(rules: readonly Rule[]): Readonly<Record<string, FileIconDescriptor>> {
  const result: Record<string, FileIconDescriptor> = Object.create(null);
  for (const [kind, names] of rules) for (const name of names) result[name] = FILE_ICONS[kind];
  return Object.freeze(result);
}
const byExtension = table(extensionRules);
const byFilename = table([
  ...filenameRules,
  ...configFamilies.map(([kind, names]): Rule => [kind, names.flatMap(name => configSuffixes.map(suffix => name + suffix))]),
]);

export function resolveFileIcon(path: string, isDir = false, isOpen = false): FileIconDescriptor {
  if (isDir) return isOpen ? FILE_ICONS.folderOpen : FILE_ICONS.folder;
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase();
  const exact = byFilename[name];
  if (exact) return exact;
  if (name.startsWith('.env.') || name.startsWith('dockerfile.') || name.startsWith('containerfile.')) {
    return name.startsWith('.env.') ? FILE_ICONS.config : FILE_ICONS.docker;
  }
  if (name.endsWith('.mdx.tsx')) return FILE_ICONS.markdown;
  const dot = name.lastIndexOf('.');
  return (dot >= 0 ? byExtension[name.slice(dot + 1)] : undefined) ?? FILE_ICONS.file;
}
