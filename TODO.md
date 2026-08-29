# Todo

先不改代码，只记着。

## 4.1 内存

- [ ] 进托盘后把官方 `WebContentsView` 卸成 `about:blank`（或摘掉 view），再显示时重新 `loadURL`
- [ ] 监听 `render-process-gone` / `unresponsive`，销毁坏掉的 view 再新建
- [ ] 不上窗口池、不多开 modal 窗

## 4.3 差量更新

- [ ] 正式 `appId`（不要再用 `com.example.dsh-desktop`）
- [ ] 真实 HTTPS 更新源，不再默认 `localhost:8080`
- [ ] Release 挂上 `latest.yml` / `latest-mac.yml` 和 `*.blockmap`
- [ ] mac 自动更新走 zip，dmg 只给人点下载
- [ ] 保持用户确认后再下载、再安装

## 4.4 数据目录

- [ ] 安装目录只读；用户数据只写 `userData` / `DSH_HOME`
- [ ] 开发包和正式包分开 `userData`（例如后缀 `-dev`），避免改到真实 `~/.dsh`
- [ ] 打包后禁止环境变量改 `userData`、更新源
- [ ] 日志不要打 API Key；安全模式回正常模式不要合并插件目录

## 4.5 路径与图标

- [ ] `build/icon.ico` / `icon.icns` / `icon.png`，写进 `electron-builder`
- [ ] 托盘用 16/32 图；mac 用模板图
- [ ] Windows `app.setAppUserModelId`，和正式 `appId` 一致
- [ ] 资源路径只走 `process.resourcesPath` / `__dirname`，不假设 cwd

## 以后再说

- [ ] macOS Developer ID 签名 + 公证
- [ ] `session.setPermissionRequestHandler` 拦权限
- [ ] 原生 `dialog` 选工作区目录
- [ ] `powerMonitor`：睡眠唤醒后探活引擎
- [ ] Sentry / 崩溃上报（对应 4.2）
