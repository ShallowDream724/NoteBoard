# 文档颜色与透明度

文档样式使用小写的 `#rrggbb` 或 `#rrggbbaa` 色值。语法入口先把 RGB、RGBA 和短 HEX 规范化；`documentColor` 只接收这两种持久化格式。透明度为零仍是明确的颜色值，不会被当成未设置。正文、块、提示块和图注沿用同一颜色校验，界面颜色预设保持不变。

透明颜色的对比度先把背景叠加到实际画布，再把文字叠加到该背景。`contrastRatio(foreground, background, canvas)` 的第三个参数指定画布，省略时使用白色；`relativeLuminance` 与 `readableBlockText` 也可指定底色。颜色解析支持 HEX3、HEX4、HEX6、HEX8 和 RGB/RGBA。

深色阅读的填色投影保留原始透明度，文字及提示边框根据深色表面合成后的颜色计算可读性。可读性补偿只生成界面变量，保存、剪贴板及导出的语义颜色始终采用文档原值。
