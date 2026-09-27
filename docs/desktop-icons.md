# 桌面图标

`src-tauri/icons/icon-source.png` 是完整源图：蓝紫边框、实色浅色纸面及白色一体笔身；纸面在深色或复杂壁纸上保持可辨，图标外部透明。笔身使用浅灰轮廓和连续锥形笔尖，不加蓝色笔杆或黑白拼接。

修改源图后运行 `python scripts/generate-icons.py`（需要 Pillow），生成 Tauri 的 32/128/256/512 PNG、含 16/24/32/48/64/128/256 七档的 ICO，以及网页 `public/logo.png`/`logo.ico`。桌面程序、安装器与网页共用同一设计，不单独修改缩略文件。脚本验证 ICO 尺寸及纸面/外部透明度。
