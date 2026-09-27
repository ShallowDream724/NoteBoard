# 桌面图标

`src-tauri/icons/icon-source.png` 是完整源图：蓝紫边框、实色浅色纸面及白色一体笔身；纸面在深色或复杂壁纸上保持可辨，图标外部透明。笔身使用浅灰轮廓和连续锥形笔尖，不加蓝色笔杆或黑白拼接。

修改源图后运行 `python scripts/generate-icons.py`（需要 Pillow），生成 Tauri 的 32/128/256/512 PNG、含 16/24/32/48/64/128/256 七档的 ICO，以及网页 `public/logo.png`/`logo.ico`。桌面程序、安装器与网页共用同一设计，不单独修改缩略文件。脚本验证 ICO 尺寸及纸面/外部透明度。

Windows 安装包还把同一 `icons/icon.ico` 作为 `NoteBoard-white-pen.ico` 安装到应用目录。安装钩子只更新已存在、目标为当前安装或旧 Codex LocalCache 安装的 NoteBoard 桌面及开始菜单快捷方式：将旧 LocalCache 目标迁移到当前安装，设置显式图标路径，并通知 Shell 刷新这些快捷方式。更新图标设计时，同步修改 `tauri.conf.json` 的资源目标文件名及 `hooks.nsh` 中的图标路径，让 Windows 将新版图标识别为新资源。
