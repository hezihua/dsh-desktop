# Infini 运维 Agent

面向**服务器运维**（本机 + SSH 远程）：监控对话、规则分析报告、按主机授权、Cron 自动化。  
无多项目工单 / Grafana Webhook 等历史模块依赖即可独立运行。

## 文档

**完整使用说明（推荐先读）：** [docs/使用指南.md](./docs/使用指南.md)

环境变量模板：`config/env.example` → 复制为 `.env.local`

## 快速开始

```bash
pnpm install
pnpm dev   # http://localhost:3000/monitor
```

## 模块一览

| 页面 | 作用 |
|------|------|
| **监控** | 对话只读巡检；可选 LLM（OpenRouter）或本地规则 |
| **分析** | 规则引擎报告（负载/内存/磁盘/journal）；列表与定时全量 |
| **主机** | SSH 登记（OpenSSH 配置 → `data/ssh-hosts.conf`） |
| **权限** | 每台服务器单独授权 + 全局命令/路径白名单 |
| **自动化** | Cron：分析报告或白名单命令；默认每天 08:00 全量分析 |
| **Skills** | `.agent/skills/` 下的 Agent Skill（`SKILL.md`） |

## SSH 一分钟

1. **主机** → 粘贴 `Host` 块 → 保存并加载（示例：`config/ssh-hosts.example.conf`）
2. **权限** → 下拉选择该主机 → 开启「授权 Agent 访问」→ 保存
3. **监控 / 分析 / 自动化** 中即可选该主机

依赖系统 `ssh` 命令；远程与本地共用 **allowedCommands** 前缀白名单。

## 可选 LLM

```bash
# .env.local
OPENROUTER_API_KEY=sk-or-v1-...
MONITOR_AI_MODEL=deepseek/deepseek-chat
```

仅 **监控对话** 使用 LLM；**分析报告与 Cron** 均为规则引擎。详见 [使用指南 §6](./docs/使用指南.md#6-监控对话)。

## 数据目录

运行时数据在 `data/`（gitignore）：策略、报告、SSH、定时任务与执行记录。详见 [使用指南 §9](./docs/使用指南.md#9-数据文件默认-data已-gitignore)。

## 脚本

```bash
pnpm build   # 生产构建
pnpm start   # 生产启动（Cron 需进程常驻）
pnpm lint
```
