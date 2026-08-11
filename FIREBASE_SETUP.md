# 跨设备自动同步：一次性 Firebase 设置

这个版本使用 Firebase Authentication + Realtime Database。只需要设置一次；之后同一账号可以在 iPhone、iPad、电脑之间自动同步。

## 1. 创建 Firebase 项目

1. 打开 Firebase Console。
2. 创建一个项目，例如 `monthly-task-timeline`。
3. Analytics 可以不启用。

## 2. 注册 Web App

1. 在 Firebase 项目首页点 Web 图标 `</>`。
2. 给 App 起一个名字，例如 `Task Timeline Web`。
3. 点 Register app。
4. Firebase 会显示一个 `firebaseConfig` 对象。

本配置包里的 `firebase-config.js` 已经根据你的 Firebase 项目填好：

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

本包已经填入 Realtime Database URL：`https://monthly-task-timeline-default-rtdb.firebaseio.com`。

## 3. 开启邮箱/密码登录

Firebase Console → Authentication → Sign-in method：

- 启用 `Email/Password`
- 保存

如果 Firebase 要求设置 Authorized domains，把你的 GitHub Pages 域名加入，例如：

`yourname.github.io`

## 4. 创建 Realtime Database

Firebase Console → Realtime Database：

1. 点 Create Database。
2. 选择数据库位置。
3. 创建完成后进入 Rules。
4. 把本 ZIP 里的 `database.rules.json` 中 `rules` 的内容复制到 Rules 编辑器并 Publish。

最终规则应限制为：每个登录用户只能读写 `users/{自己的 uid}` 下的数据。

## 5. 重新上传 GitHub Pages

把 ZIP 内这些文件全部上传到 repository 最外层：

- `index.html`
- `sync.js`
- `firebase-config.js`
- `database.rules.json`
- `manifest.webmanifest`
- `sw.js`
- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512.png`
- `README.md`
- `FIREBASE_SETUP.md`

确保 `index.html` 在 repository 根目录。

## 6. 第一次登录

建议先在**目前保存有完整任务数据的设备**上操作：

1. 打开 App → 数据/备份 → 跨设备自动同步。
2. 输入邮箱和密码。
3. 点“注册同步账号”。
4. 如果云端为空，本机现有任务会自动上传。

然后在其他设备：

1. 打开同一个 GitHub Pages App。
2. 用同一个邮箱和密码登录。
3. 云端任务会自动载入。
4. 后续任一设备修改任务，其他已登录设备会自动收到更新。

## 同步逻辑

数据按项目分别同步，而不是每次覆盖整个数据库：

- 每个 Todo 任务独立同步
- 每个 Done 时间块独立同步
- 每个计划时间块独立同步
- 类别、类别颜色、当前计时器作为设置同步

这样不同设备同时修改不同任务时，不会因为整份数据互相覆盖；如果两台设备在几乎同一时间修改**同一条任务**，最后写入的版本会成为最终版本。

## 数据安全说明

- Firebase Web 配置对象本身不是账号密码；真正的数据访问由 Firebase Authentication + Realtime Database Rules 控制。
- 不要把 Firebase Admin 私钥、Service Account JSON 或其他私人 secret 放到 GitHub Pages。
- JSON 导出功能仍然保留，建议定期做手动备份。

## 同步范围

自动同步：

- Todo 任务
- 已完成任务 / Done 时间块
- Todo 计划时间块
- 类别选项
- 类别颜色
- 当前运行中的计时器

不跨设备同步：

- 当前正在浏览的日期 / 月份

每次打开 App 仍自动跳到多伦多时区的今天。
