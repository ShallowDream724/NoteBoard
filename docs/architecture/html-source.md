# HTML 文件与源码编辑

`.html` 与 `.htm` 使用共享扩展名映射归类为 `code` / `html`。Rust 和前端使用同一映射，语言枚举同步；状态栏显示 HTML，标签页和资源树使用带源码符号的橙色浏览器图标。

HTML 标签默认显示阅读预览。编辑区左下角的浮动按钮在预览与源码之间切换，打开或切回标签、切换模式时显示三秒。鼠标移到编辑区左下角或通过 Tab 聚焦按钮可重新显示，HTML 预览使用左下方的窄边缘感应鼠标。也可用 Ctrl+/ 切换。回到预览时读取当前修改，再次打开源码时恢复选区和滚动位置。普通 HTML 在禁脚本的 sandbox iframe 内读取，NoteBoard 独立导出页的增强与资源解析规则见[文档导出](document-export.md)。

普通 HTML 同时包含 JavaScript 和画布，或含 JavaScript 而正文缺少静态内容时，预览会说明哪些内容可能无法显示。提示中的浏览器按钮打开磁盘上已保存的文件。

源码编辑使用全局保存、撤销、搜索与替换快捷键，并始终显示行号。CodeMirror 按需加载 `@codemirror/lang-html`，支持 HTML 及内嵌 CSS/JavaScript。底栏的语言按钮调整语法高亮。

标题栏快速打开按钮左边的地球通过系统默认应用打开磁盘上的 HTML 文件。保存位于窗口左上角，另存为使用 Ctrl+Shift+S，文件定位在资源树右键菜单中。应用内预览可以直接查看未保存的修改。

导出 HTML 成功后，`presentExportedFile` 报告文件大小和警告、刷新所在工作区，并在应用内打开 HTML 标签。标签打开失败仍保留导出成功提示并说明保存位置。其他导出格式沿用相同的完成展示。

桌面回归用 `scripts/launch-native-qa.py` 打开含相对路径图片的 HTML，再运行 `node scripts/check-html-preview-native.mjs <启动记录.json> <图片数> [标签名]`。检查会在 WebView2 的预览框内逐张解码图片，能检出宿主可读而预览却显示破图的情况。
