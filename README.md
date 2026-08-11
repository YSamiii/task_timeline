# 月度任务 + 时间轴 Todo/Done App（跨设备同步版）

这是可以部署到 GitHub Pages，并添加到 iPhone 主屏幕的 PWA。

## 新增：跨设备自动同步

本版增加 Firebase Authentication + Realtime Database 同步：

- 同一账号在 iPhone、iPad、电脑登录
- Todo、Done、计划时间块、类别、类别颜色自动同步
- 当前计时器也会同步
- 每条任务 / 时间块独立写入云端，减少不同设备互相覆盖的风险
- 本地数据仍保留，断网时可继续使用；网络恢复后会继续同步待处理修改
- JSON 手动备份仍保留

**第一次部署前，请先阅读 `FIREBASE_SETUP.md`。**

## GitHub 文件结构

请把这些文件直接上传到 repository 最外层：

- `index.html`
- `sync.js`
- `firebase-config.js`
- `database.rules.json`
- `manifest.webmanifest`
- `sw.js`
- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512.png`
- `FIREBASE_SETUP.md`
- `README.md`

必须确保 `index.html` 在 repository 最外层。

## 主要功能

- 月度任务追踪：每日新增、正式完成、临时 Done、累计未完成
- 一周以周一开始
- 任务类别下拉菜单，支持自定义类别和类别颜色
- 收到日期与计划执行日期分离
- 从未完成任务池安排任意日期的 Todo 计划时间块
- 每日单条纵向时间轴：左侧计划 Todo，右侧实际 Done
- Todo 时间块可修改、删除
- 任务完成后自动累计该任务全部实际时间块并显示总耗时
- 直接记录时间块时可选择任务是否完成
- 24 小时制时间输入
- 已完成任务池 / 未完成任务池
- JSON 备份 / 导入、CSV 导出
- iPhone 主屏幕 App icon
- 每次启动自动定位多伦多时区的今天

## iPhone 安装

1. 完成 Firebase 设置并上传到 GitHub Pages。
2. 用 Safari 打开网址。
3. 分享 → 添加到主屏幕。
