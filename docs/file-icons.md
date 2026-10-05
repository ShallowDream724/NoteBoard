# 文件图标

文件类型展示使用 Pierre Icons for VS Code 的原始 SVG，固定到 `04a9028f0b227aaf820e9e73da2992af86ba0f26`。MIT 许可、原始文件、来源 URL 与 SHA256 存放于 `vendor/pierre-file-icons`；构建会附带 `licenses/pierre-vscode-icons.txt`。不安装 Pierre Trees，也不替换现有目录树、虚拟列表或拖拽逻辑。

## 职责

- `core/fileIconCatalog.ts`：纯分类。先判目录开闭状态，再判大小写无关的完整文件名、有限配置文件族与扩展名；路径同时支持 Windows 和 POSIX 分隔符。`Dockerfile`、`.gitignore`、`package.json`、`go.mod`、`.env.local` 等优先于普通扩展名。没有模糊子串匹配或按路径增长的缓存。
- `components/FileIcon.tsx`：共用展示组件，保留 `getFileIcon` 接口；固定格式菜单通过模块级 `createFileTypeIcon` 创建图标组件。消费者不复制分类逻辑。`NoteBoardFileIcon` 保留原有品牌设计和具名接口。
- `components/FileIcon.css`：Pierre 主题色。晨光、琥珀使用浅色配色，墨夜使用深色配色；Python、Astro、Webpack 的第二色也随主题切换。更改根主题属性无需图标单独订阅主题。
- `assets/file-icons.svg`：59 个生成的 Pierre symbol；每个源内的渐变 ID 有独立命名空间，非 16×16 的原图保持比例并居中。
- `assets/noteboard-file-icons.svg`：14 个 NB 补充 symbol，覆盖 NB、画板、脑图、流程图、多维表格、信息图、文档、演示、公式、电子书、影音、设计和三维模型。

图标分类只影响外观，不决定是否能编辑、编码或保存。文档类型和语言仍由 `docKind`、`languageByExt` 与 `languageByFilename` 管理。

## 展示入口

| 界面 | 入口 |
| --- | --- |
| 资源管理器文件、目录和 NB 附属 Markdown | `TreeNode` → `getFileIcon` |
| 标签页与标签菜单中的文件 | `TabBar` → `getFileIcon` |
| 收藏文件、目录树、目录卡片、当前位置与新目录占位 | `FavoritesManagerModal` → `getFileIcon` |
| 文件选择器条目与常用目录位置 | `PathBrowser` → `getFileIcon` |
| 资源管理器目录路径 | `ExplorerBreadcrumb` → `getFileIcon` |
| 外部文件详情及导出结果 | `UnsupportedView` → `getFileIcon` |
| 欢迎页与标题栏的新建格式项 | `createFileTypeIcon` / `NoteBoardFileIcon` |
| 设置中的文件树排版预览 | `TypographyPanel` → `getFileIcon` |
| 设置中的 NB 品牌标题 | `NoteBoardFileIcon` |

最近文件与暂存区沿用其现有展示和上述文件列表入口，不新增另一套图标分类。打开、保存、导出、编辑器模式、磁盘、收藏及文本比较等操作或工具图标继续使用其语义图标。

## 性能与更新

每个可见图标只包含 `svg` 与 `use` 两个节点；两份精灵通过 Vite 的本地资源 URL 共享，浏览器复用解析和资源缓存，不把全部路径复制进每个行节点。组件使用 `memo`，无 effect、定时器、观察器、文件系统读写或远程加载。类别表在模块加载时初始化一次，单个文件名的解析不保留输入路径。

运行 `pnpm icons:files` 离线重生成，`pnpm icons:files:check` 检查源指纹和生成一致性；`prebuild` 同样校验。升级上游时按 vendor README 同步提交、清单、许可和精灵；增加应用类型时更新分类与补充精灵。不要在消费者中引入独立图标规则。

## 验证

`test/explorer/fileIcons.test.tsx` 验证重要格式、路径与大小写、文件名优先级、目录状态、未知格式回退、共同展示入口及每个引用的实际 symbol。`scripts/check-file-icons.mjs` 使用生产构建检查三套主题、精灵实际几何尺寸与资源复用；浏览器模式反复展开/收起千文件目录并记录 GC 后 heap、DOM 与监听器。预览服务器对带指纹的资源使用长期缓存，同时记录实际传输字节，避免把浏览器的逻辑资源请求误计为再次下载 SVG。原生模式先用 `scripts/launch-native-qa.py --open-path <样本目录>` 启动，再设置 `NOTEBOARD_TEST_CDP` 接入；启动路径和目录读取均使用正式 CLI 与真实 IPC，不注入模拟桥。

2026-10-06 本机验收：相关 151 项测试、TypeScript、改动范围 ESLint、精灵离线一致性检查和首屏预算均通过。首屏 JS 从 1036.1 降到 1030.9 KiB，CSS 从 96.4 到 98.4 KiB；两份 SVG 共 43,613 字节。原生目录中 63 个实际挂载图标在晨光、琥珀、墨夜均具有有效形状尺寸，浏览器及原生页面没有 JavaScript 异常。

千文件目录展开/收起十轮，最后五轮收起后 GC heap 为 11.43–11.48 MiB，DOM 均为 1,384 个节点，监听器均为 399 个；精灵实际传输总量维持 14,503 字节，没有随循环增加。这是图标所在文件树生命周期的回归检查，不把它当作整个应用所有编辑器的内存上限。原生进程及 WebView2 后代的单次稳定私有内存采样另存于验收产物，不与浏览器 JS heap 混用。
