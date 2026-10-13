# Draw.io 在线编辑边界

Draw.io 使用 diagrams.net 在线 iframe，不在本地运行绘图内核。打开文件先显示“启用在线编辑”；用户启用后才创建 `https://embed.diagrams.net` iframe，并把当前图表 XML 发送给该页面。选择仅属于当前文档视图，切换文档或重新挂载后重新选择。启用前不加载远程页面、不注册消息监听、不启动网络超时，也不生成或改写本地 XML；保存、暂存和回收的 flush 返回现有本地内容，合法空文件仍为空。

未启用在线编辑的实例可直接回收，重新挂载恢复本地内容并重新请求启用。已启用但引擎尚未就绪、加载失败或 XML 捕获未确认的实例继续拒绝回收，避免丢失在线编辑状态。

所有入站消息同时验证精确 origin 与当前 iframe 的 `contentWindow`；所有出站消息指定精确 origin。文档视图按 `docKey` 创建独立实例，能力、请求和回调携带会话代际。更换文档、卸载或重新连接会结束在途 XML 捕获并清理监听与超时；旧 iframe、旧请求及迟到的异步导出不发布内容或成功提示。加载超时读取同步就绪状态，不使用初始 render 的旧闭包。

iframe sandbox 仅允许脚本和 diagrams.net 自身 origin；不允许顶层导航、弹窗、表单提交或直接下载。DOM 输入、标准粘贴不受这些限制，允许用户操作的剪贴板写入供复制；图像导出通过匹配的回包与宿主原生文件对话框完成。页面不发送 referrer。

XML 捕获仍使用官方 `message` 回传请求身份；请求超时返回 `null`，不把旧镜像伪装成已确认的新编辑。在线引擎推送的 XML 只有实际变化才递增 revision，脏态由磁盘基线计算；相同的 autosave 回包不制造未保存圆点。手动保存复用统一保存队列，只有 `saveDocument` 返回成功且会话仍有效时显示成功提示。SVG/PNG 导出在引擎就绪前禁用。

SVG/PNG 导出同样要求回包 `message` 的 requestId、请求格式及回包格式同时匹配当前用户请求；只保留一个在途图像请求，30 秒超时或重连、卸载时失效。没有对应请求的导出回包不会读取数据或打开系统保存对话框。

应用 CSP 只允许该精确在线 frame origin。协议与同意边界测试使用 jsdom 消息替身，不连接远程服务：`test/drawio/drawioConsent.test.tsx`、`test/performance/round4/drawioProtocol.test.tsx`、`drawioResponseRound4.test.tsx`。真实 diagrams.net 可用性和用户网络仍属于运行时条件。
