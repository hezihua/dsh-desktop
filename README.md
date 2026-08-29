# dsh-desktop

Electron 桌面壳，嵌入官方 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)。主进程拉起 `dsh web`，官方 UI 放在 `WebContentsView` 里；标题栏、启动页和自动更新留在壳层，不注入官方 DOM。

## 下载

- [Windows x64 安装包](https://github.com/hezihua/dsh-desktop/releases/latest/download/dsh-desktop-win-x64.exe)
- [全部版本](https://github.com/hezihua/dsh-desktop/releases)

安装包由 GitHub Actions 在 Windows 上构建。体积较大（内含完整 `@deepseek-ai/dsh`）。没装 Node 时会尝试用 Electron 内置 Node 启动引擎。

## 要求

- Node.js **22.19+** 或 **24+**（Harness 官方 engines）
- 本机需能解析 npm 上的 `@deepseek-ai/dsh`
- Electron 39 自带 Node 22.20。优先用系统 Node；找不到合格 Node 时回退 `ELECTRON_RUN_AS_NODE`

## 开发

```sh
pnpm install
pnpm electron:dev
```

WSL / 精简 Linux 若缺 `libnss3.so`，`electron:dev` 会自动把对应库解到 `.electron-libs/`（无需 sudo）。更稳妥的做法仍是装系统包：

```sh
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

启动页出现后，引擎就绪会在标题栏下方嵌入官方界面。会话和配置默认写在 `~/.dsh`，与 CLI 共用。若本机已有 `dsh web`（例如 3080），会先尝试附着而不是再起一份。

可选环境变量：

| 变量 | 含义 |
| --- | --- |
| `DSH_NODE_PATH` | 指定 Node 可执行文件 |
| `DSH_HOME` | Harness 数据目录，默认 `~/.dsh` |
| `DSH_DESKTOP_PORT` | 附着时优先探测的端口，逗号分隔 |
| `UPDATE_SERVER_URL` | 自动更新源，默认 `http://localhost:8080/updates/` |

## 打包

```sh
pnpm electron:build
```

产物在 `release/`。原生模块保持 Node ABI（`npmRebuild: false`）。Windows 安装包请在 Windows 上执行 `pnpm electron:build:win`，或打 `v*` tag 推送后由 CI 生成并挂到 [Releases](https://github.com/hezihua/dsh-desktop/releases)。

## 结构

```
electron/          主进程：dsh 监护、WebContentsView、自动更新
src/               壳层（React）：标题栏 + 启动页 + 更新弹层
```

窗口关闭时结束由本应用拉起的引擎进程树；附着到已有 `dsh web` 时不会杀那个进程。
