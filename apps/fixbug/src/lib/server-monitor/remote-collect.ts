import type { AgentCapabilities } from "@/lib/agent-policy";
import { assertReadablePath } from "./access";
import { formatBytes } from "./collect";
import { getSshHost } from "@/lib/ssh/store";
import { sshExecRemote, sshExecRemoteById } from "@/lib/ssh/exec";

function mustRemote(
  hostId: string,
  command: string,
  caps: AgentCapabilities,
): string {
  const res = sshExecRemoteById(hostId, command, caps);
  if (!res.ok) throw new Error(res.error ?? "SSH 执行失败");
  return res.stdout;
}

export function formatRemoteOverviewMarkdown(
  hostId: string,
  caps: AgentCapabilities,
): string {
  const meta = getSshHost(hostId);
  const label = meta ? `${meta.name} (${meta.username}@${meta.host})` : hostId;
  const uname = mustRemote(hostId, "uname -a", caps);
  const uptime = mustRemote(hostId, "uptime", caps);
  const free = mustRemote(hostId, "free -h", caps);
  const disk = mustRemote(hostId, "df -h", caps);
  return [
    `## 远程主机概览`,
    `- **目标**: ${label}`,
    "",
    "### uname",
    "```",
    uname,
    "```",
    "### uptime",
    "```",
    uptime,
    "```",
    "### 内存",
    "```",
    free,
    "```",
    "### 磁盘",
    "```",
    disk,
    "```",
  ].join("\n");
}

export function remoteDiskUsage(hostId: string, caps: AgentCapabilities): string {
  return mustRemote(hostId, "df -h", caps);
}

export function remoteTailLog(
  hostId: string,
  filePath: string,
  lines: number,
  caps: AgentCapabilities,
): string {
  const check = assertReadablePath(filePath, "log");
  if (!check.ok) throw new Error(check.reason);
  const n = Math.min(Math.max(lines, 1), 200);
  const cmd = `tail -n ${n} ${check.path}`;
  return mustRemote(hostId, cmd, caps);
}

export function remoteReadConfig(
  hostId: string,
  filePath: string,
  caps: AgentCapabilities,
): string {
  const check = assertReadablePath(filePath, "config");
  if (!check.ok) throw new Error(check.reason);
  return mustRemote(hostId, `cat ${check.path}`, caps);
}

export function remoteProcessSnapshot(hostId: string, caps: AgentCapabilities): string {
  return mustRemote(hostId, "ps aux --sort=-%mem", caps);
}

export function testSshHost(hostId: string, caps: AgentCapabilities): string {
  const host = getSshHost(hostId);
  if (!host) throw new Error("主机不存在");
  const res = sshExecRemote(host, "uname -a", caps);
  if (!res.ok) throw new Error(res.error ?? "连接失败");
  return res.stdout;
}
