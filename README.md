# dsh-desktop

Electron 桌面壳，嵌入官方 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)。主进程拉起 `dsh web`，官方 UI 放在 `WebContentsView` 里；标题栏、启动页和自动更新留在壳层，不注入官方 DOM。

## 下载

- [Windows x64 安装包](https://github.com/hezihua/dsh-desktop/releases/latest/download/dsh-desktop-win32-x64.exe)
- [macOS Apple Silicon](https://github.com/hezihua/dsh-desktop/releases/latest/download/dsh-desktop-darwin-arm64.dmg)
- [macOS Intel](https://github.com/hezihua/dsh-desktop/releases/latest/download/dsh-desktop-darwin-x64.dmg)
- [全部版本](https://github.com/hezihua/dsh-desktop/releases)

安装包由 GitHub Actions 分别在 Windows / macOS 上构建，内含完整 `@deepseek-ai/dsh` 和一份 Node 22。没装 Node 也能双击启动。关闭窗口会进托盘，引擎继续跑；托盘菜单里退出才会结束进程。

macOS 安装包未签名。若提示「无法打开 / 已损坏」，在终端执行：

```sh
xattr -dr com.apple.quarantine "/Applications/dsh-desktop.app"
```

## 要求

- **开发**：Node.js **22.19+** 或 **24+**
- **安装包**：自带 Node，不依赖本机环境
- 本机需能解析 npm 上的 `@deepseek-ai/dsh`（仅从源码构建时）

## 开发

```sh
pnpm install
pnpm electron:dev
```

WSL / 精简 Linux 若缺 `libnss3.so`，`electron:dev` 会自动把对应库解到 `.electron-libs/`（无需 sudo）。更稳妥的做法仍是装系统包：

```sh
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

启动页出现后，引擎就绪会在标题栏下方嵌入官方界面。会话和配置默认写在 `~/.dsh`，与 CLI 共用。若本机已有 `dsh web`（例如 3080），会先尝试附着而不是再起一份。启动失败可「打开日志」或「安全模式」（独立数据目录，不加载 `~/.dsh` 插件）。

可选环境变量：

| 变量 | 含义 |
| --- | --- |
| `DSH_NODE_PATH` | 指定 Node 可执行文件 |
| `DSH_HOME` | Harness 数据目录，默认 `~/.dsh`（安全模式除外） |
| `DSH_DESKTOP_PORT` | 附着时优先探测的端口，逗号分隔 |
| `UPDATE_SERVER_URL` | 自动更新源，默认 `http://localhost:8080/updates/` |
| `NODEJS_ORG_MIRROR` | 打包时下载 Node 的镜像，默认 `https://nodejs.org/dist` |

## 打包

```sh
pnpm electron:build
```

会先下载官方 Node 到 `resources/node/`，再打进 `extraResources`。产物在 `release/`。原生模块保持 Node ABI（`npmRebuild: false`），必须在目标系统上打包：

```sh
pnpm electron:build:win   # Windows
pnpm electron:build:mac   # macOS（当前机器的 arch）
```

或先提交 `main`，再打 `v*` tag 推送，由 CI 生成并挂到 [Releases](https://github.com/hezihua/dsh-desktop/releases)：

```sh
git tag -a v0.2.1 -m "v0.2.1"
git push origin main
git push origin v0.2.1
```

标签必须先在本地用 `git tag` 建好，再 `git push origin v0.2.1`。下次发版把 `v0.2.1` 换成新版本号即可。

## 结构

```
electron/          主进程：dsh 监护、WebContentsView、托盘、自动更新
src/               壳层（React）：标题栏 + 启动页 + 更新弹层
scripts/           WSL 系统库、打包用 Node 下载
TODO.md            后续优化清单（先不改代码）
```

关闭窗口会隐藏到托盘，引擎继续跑；托盘或菜单「退出」才结束由本应用拉起的进程。附着到已有 `dsh web` 时，退出也不会杀那个进程。
