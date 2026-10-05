# 文件查看与编辑验收

2026-10-06，运行实现提交 `7e830d6`，本地版本 1.0.2。文件能力与资源边界见 [file-classification.md](architecture/file-classification.md)。

## 交付范围

- 前后端共用文件能力清单；文件格式、语法选择、图标各自保持职责。支持特殊文件名和前缀，手动换高亮保留编辑器、光标与历史。HTML 浏览器操作按文件格式判断，Vue 等源码不会因 HTML 高亮而获得这些操作。
- CSV/TSV 在源码和只读表格间切换，完整解析引用、跨行字段和不齐列数；支持 A1 定位、完整字段详情与复制。大表使用双轴虚拟化，并明确提示资源上限或语法错误。
- JSON 格式化保留大整数、重复键及原始字面量；JSON/YAML 后台处理可取消并释放，XML 校验与格式化有明确输入、输出和层级边界。
- SVG 保留图片功能，按需加载只读 XML 源码视图；专业二进制文件使用系统程序打开、定位或复制路径，不载入文本编辑器。未知候选先嗅探，禁止有损解码后覆写。
- 代码输入按历史组暂存不可变 Text，保存、撤销、回收和预览切换复用统一提交屏障；不在每次按键中复制全文。

## 回归与生产页面

全量 Vitest **304 个文件、2421 项通过**。末轮 HTML 文件操作与语法分离新增 2 项回归，相关 15 项定向检查通过；焦点同步调整后另复核 3 项语言/视图生命周期。TypeScript、相关 ESLint、生产 Vite 构建与首屏预算通过。Rust 全量 **120 项通过、1 项原有 ignored**。

6 MiB 连续四笔输入在真实 CodeEditor update listener / CodeMirror Text / history 上验证，省略渲染层以区分应用序列化与内核可见行读取。全文 `toString()` 次数为 `[0,0,0,0]`，立即保存后为 `[0,0,0,1]`。自动保存、跨组撤销重做、恢复精确脏态、预览切换、卸载及同路径旧会话均覆盖。

`scripts/check-file-capabilities.mjs` 使用生产 dist 和 Edge，文件系统 IPC 为测试替身，编辑器、菜单、Worker、样式均为真实实现。100,000×30 CSV 首次打开到表格就绪 **922ms**（单次端到端采样，含懒加载，不含真实磁盘耗时），末格 AD100000 的完整内容为 END；可见区域只挂载 **243 个单元格**。大 JSON 和 YAML 的真实 Worker、Go→Python 菜单切换、SVG 源码、外部格式页面均通过，无页面异常。

连续开关大表 10 次并触发 GC，每次关闭后 Worker 为 0。最后五次 JS heap 为 **16.90–17.16 MiB**，DOM 节点保持 **1119**、监听器保持 **379**。最终全部工作流结束时已创建的 14 个 Worker 全部释放。此采样验证本轮生命周期，不代表全软件峰值或无限次数的证明。

## 原生与内存

`scripts/launch-native-qa.py` 使用隔离 APPDATA / LOCALAPPDATA / WebView2 配置及系统字体，不改日常配置。`scripts/check-file-capabilities-native.mjs after` 通过真实磁盘 IPC 打开 6,000,001 字节的 CSV，访问 AD100000，挂载 **198 个单元格**。原生 SVG 分类、`.env.production` 语言识别及 `read_document` 上限拒绝均通过，无页面异常。已检查生产浏览器和原生截图。

| 同一 CSV 的隔离原生进程树 | 旧版源码视图 | 新版表格视图 |
| --- | ---: | ---: |
| Private bytes | 366,661,632 B（349.7 MiB） | 348,839,936 B（332.7 MiB） |
| Working set 总和 | 631,844,864 B | 626,184,192 B |
| 主页面 GC 后 JS heap | 19,312,136 B | 17,656,304 B |

这是各一次稳定采样，旧、新视图不同，不作为同一编辑器性能提升比例；working set 总和会重复计入共享页。原生 UTF-8 读取另有 50 MiB 测试，验证直接消费原缓冲区、保留指针与容量；BOM 原地移除。文件增长、二进制及不可无损解码文本的边界均覆盖。

## 包体与本地安装

没有新增依赖或改变 lockfile。首屏 JS **1034.2 KiB**，上一版 **1030.9 KiB**；CSS 保持 **98.4 KiB**。CSV 查看器、SVG 源码与后台处理按需加载，首屏未引入禁止的重依赖。

| 产物 | 上一版 | 本轮 | 增量 |
| --- | ---: | ---: | ---: |
| NSIS 安装包 | 10,915,239 B | 11,020,785 B | 105,546 B（103.1 KiB，0.97%） |
| 应用 EXE | 25,898,496 B | 26,027,008 B | 128,512 B（125.5 KiB，0.50%） |

先完成 TypeScript/Vite 生产构建和预算，再将该已验证 dist 打入 NSIS；本轮原生构建的 beforeBuildCommand 只重复版本、图标和预算检查，不重新下载依赖。覆盖安装至 `C:/Users/dell/AppData/Local/NoteBoard`，安装器退出码 0；按实际文件句柄核对目录，并确认已安装 EXE 与构建仅有 Tauri 安装类型标记差异。收据在输出目录 `NoteBoard-file-capabilities-host-installation.json`。

安装包 SHA-256：`3f4fd4f1cd2ada59001c1bc9284765d8743fb33dea618a6c0df0c727fd18d49b`。

## 复测入口

- 人工样例在工作区 `outputs/File-Text-Samples/README.md`：10 万行表格、引用 TSV、无损 JSON、YAML、代码和 SVG。
- `node node_modules/vitest/vitest.mjs run --maxWorkers=4`；`cargo test --lib`（src-tauri 目录）。
- 先完成生产构建，再运行 `node scripts/check-budget.mjs --check` 和 `node scripts/check-file-capabilities.mjs`。Playwright 可通过 `PLAYWRIGHT_MODULE` 指向本机已有运行时，无需下载浏览器。
- 原生：`python scripts/launch-native-qa.py --name file-capabilities-after --open-path <stress.csv绝对路径>`，随后 `node scripts/check-file-capabilities-native.mjs after`。该脚本的附加读取样例位于本工作区 outputs，移到其它目录时需相应调整。
- 原始报告与截图在 `.tmp/file-capabilities/{browser,native-before,native-after}`；全量日志为 `.tmp/file-capabilities-full-tests-final.log`。交付时另复制到工作区 outputs，避免只依赖忽略目录。
