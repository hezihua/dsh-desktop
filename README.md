# dsh-desktop

Electron 桌面壳，嵌入官方 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)。启动后主进程拉起 `dsh web`，窗口加载回环上的官方 Web UI；自动更新仍走现有 `electron-updater`。

官方尚未发布 `file://` + IPC 的 Electron 应用。本仓库先按可运行的桌面方案接入官方引擎：不复刻界面，不改 Harness 协议。

## 要求

- Node.js **22.19+** 或 **24+**（Harness 官方 engines）
- 本机需能解析 npm 上的 `@deepseek-ai/dsh`
- 当前 Electron 28 内置 Node 18，**不能**用 `ELECTRON_RUN_AS_NODE` 跑引擎，开发与打包后都依赖系统 Node。可用 `DSH_NODE_PATH` 指定 `node` 可执行文件

## 开发

```sh
pnpm install
pnpm electron:dev
```

WSL / 精简 Linux 若缺 `libnss3.so`，`electron:dev` 会自动把对应库解到 `.electron-libs/`（无需 sudo）。更稳妥的做法仍是装系统包：

```sh
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

启动页出现后，引擎就绪会自动跳到 `http://127.0.0.1:<port>` 上的官方界面。会话和配置默认写在 `~/.dsh`，与 CLI 共用。

可选环境变量：

| 变量 | 含义 |
| --- | --- |
| `DSH_NODE_PATH` | 指定 Node 可执行文件 |
| `DSH_HOME` | Harness 数据目录，默认 `~/.dsh` |
| `DSH_DESKTOP_PORT` | 优先端口，逗号分隔，默认 `32123,32124,32125` |
| `UPDATE_SERVER_URL` | 自动更新源，默认 `http://localhost:8080/updates/` |

## 打包

```sh
pnpm electron:build
```

产物在 `release/`。打包后仍会在本机查找合格 Node 来执行内嵌的 `@deepseek-ai/dsh`。原生模块保持 Node ABI（`npmRebuild: false`），不要用 Electron 的 ABI 重编。

## 结构

```
electron/          主进程：拉起 dsh、窗口、自动更新
src/               启动页（React）：引擎状态 + 更新弹层
```

窗口关闭时结束引擎进程树，避免残留 `dsh web`。
