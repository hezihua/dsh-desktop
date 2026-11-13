import path from "node:path";

export const DSH_OPS_SYSTEM_PROMPT = `你是 Infini 运维 Agent（Server Agent 插件）。
只读运维：本机或通过 SSH 的远程服务器。使用 server_agent_* 工具；禁止 sudo、写文件、重启服务。
用户消息中会包含 [target=local] 或 [targetHostId=...] 表示当前监控目标，调用工具时传入对应 targetHostId。
回答使用简体中文。`;

/** monorepo / Desktop：Agent 只在客户端 Harness，fixbug 勿再连 HARNESS_URL */
export function isClientHarnessOnly(): boolean {
  const flag = process.env.CLIENT_HARNESS_ONLY?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return !process.env.HARNESS_URL?.trim();
}

export function isHarnessConfigured(): boolean {
  if (process.env.DSH_ENABLED === "false") return false;
  if (isClientHarnessOnly()) return false;
  return Boolean(process.env.HARNESS_URL?.trim());
}

export function getHarnessUrl(): string | null {
  const url = process.env.HARNESS_URL?.trim();
  return url || null;
}

export function getDshBridgePath(): string {
  return path.join(process.cwd(), "deploy/stdio-tcp-bridge.mjs");
}

export function getDshProviderModel(model?: string) {
  return {
    provider: process.env.DSH_PROVIDER || "openrouter",
    model:
      model ||
      process.env.DSH_MODEL ||
      process.env.MONITOR_AI_MODEL ||
      "deepseek/deepseek-chat",
  };
}
