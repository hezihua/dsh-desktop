import { z } from "zod";
import { tool } from "ai";
import type { AgentCapabilities } from "@/lib/agent-policy";
import { listMonitorCapabilities } from "./access";
import {
  formatOverviewMarkdown,
  getDiskUsageText,
  getHostOverview,
  getNetworkListenersText,
  getProcessSnapshot,
  listVarLog,
  readConfigFile,
  readJournalTail,
  tailLogFile,
} from "./collect";
import { sshExecRemoteById } from "@/lib/ssh/exec";
import {
  formatRemoteOverviewMarkdown,
  remoteDiskUsage,
  remoteProcessSnapshot,
  remoteReadConfig,
  remoteTailLog,
} from "./remote-collect";

export type MonitorContext = {
  caps: AgentCapabilities;
  hostId?: string | null;
};

export const monitorToolNames = [
  "host_overview",
  "disk_usage",
  "network_listeners",
  "process_top",
  "tail_system_log",
  "read_config",
  "journal_tail",
  "list_var_log",
  "capabilities",
] as const;

export type MonitorToolName = (typeof monitorToolNames)[number];

export async function executeMonitorTool(
  name: MonitorToolName,
  args: Record<string, unknown>,
  ctx: MonitorContext,
): Promise<string> {
  const remote = ctx.hostId ?? undefined;

  switch (name) {
    case "host_overview":
      return remote
        ? formatRemoteOverviewMarkdown(remote, ctx.caps)
        : formatOverviewMarkdown();
    case "disk_usage":
      return remote ? remoteDiskUsage(remote, ctx.caps) : getDiskUsageText();
    case "network_listeners":
      if (remote) {
        throw new Error("远程 ss/netstat 暂未开放，请在本机 Agent 上查看或使用 host_overview");
      }
      return getNetworkListenersText();
    case "process_top": {
      if (remote) return remoteProcessSnapshot(remote, ctx.caps);
      const limit = typeof args.limit === "number" ? args.limit : 15;
      return getProcessSnapshot(limit);
    }
    case "tail_system_log": {
      const filePath = String(args.path ?? "");
      const lines = typeof args.lines === "number" ? args.lines : 50;
      return remote
        ? remoteTailLog(remote, filePath, lines, ctx.caps)
        : tailLogFile(filePath, lines);
    }
    case "read_config": {
      const filePath = String(args.path ?? "");
      return remote
        ? remoteReadConfig(remote, filePath, ctx.caps)
        : readConfigFile(filePath);
    }
    case "journal_tail": {
      const lines = typeof args.lines === "number" ? args.lines : 60;
      if (remote) {
        const n = Math.min(Math.max(lines, 1), 200);
        const res = sshExecRemoteById(
          remote,
          `journalctl -n ${n} --no-pager -o short-iso`,
          ctx.caps,
        );
        if (!res.ok) {
          return remoteTailLog(remote, "/var/log/syslog", n, ctx.caps);
        }
        return res.stdout;
      }
      return readJournalTail(lines);
    }
    case "list_var_log":
      if (remote) {
        throw new Error("远程 list_var_log 未实现，请直接 tail 已知路径如 /var/log/syslog");
      }
      return listVarLog().join("\n") || "（/var/log 为空或不可读）";
    case "capabilities": {
      const c = listMonitorCapabilities();
      return JSON.stringify(
        {
          ...c,
          ssh: ctx.hostId ? `当前目标: 远程 ${ctx.hostId}` : "当前目标: 本机",
          canUseSsh: ctx.caps.canUseSsh,
        },
        null,
        2,
      );
    }
    default:
      return `未知工具: ${name}`;
  }
}

export function buildMonitorTools(ctx: MonitorContext) {
  const run = (name: MonitorToolName, args: Record<string, unknown> = {}) =>
    executeMonitorTool(name, args, ctx);

  return {
    host_overview: tool({
      description: "主机 CPU、内存、负载、运行时间与磁盘概览（本机或当前选中的 SSH 主机）",
      inputSchema: z.object({}),
      execute: async () => run("host_overview"),
    }),
    disk_usage: tool({
      description: "磁盘使用情况 (df -h)",
      inputSchema: z.object({}),
      execute: async () => run("disk_usage"),
    }),
    network_listeners: tool({
      description: "TCP 监听端口列表（仅本机）",
      inputSchema: z.object({}),
      execute: async () => run("network_listeners"),
    }),
    process_top: tool({
      description: "按内存排序的进程快照",
      inputSchema: z.object({
        limit: z.number().int().min(5).max(30).optional(),
      }),
      execute: async ({ limit }) => run("process_top", { limit }),
    }),
    tail_system_log: tool({
      description: "读取系统日志文件尾部（只读白名单路径）",
      inputSchema: z.object({
        path: z.string(),
        lines: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ path, lines }) => run("tail_system_log", { path, lines }),
    }),
    read_config: tool({
      description: "读取配置文件（nginx、systemd 等白名单）",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path }) => run("read_config", { path }),
    }),
    journal_tail: tool({
      description: "systemd / syslog 尾部（本机 journalctl；远程尝试 syslog）",
      inputSchema: z.object({
        lines: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ lines }) => run("journal_tail", { lines }),
    }),
    list_var_log: tool({
      description: "列出本机 /var/log 下文件",
      inputSchema: z.object({}),
      execute: async () => run("list_var_log"),
    }),
    capabilities: tool({
      description: "监控能力与路径白名单",
      inputSchema: z.object({}),
      execute: async () => run("capabilities"),
    }),
  };
}

export { getHostOverview };
