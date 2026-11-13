import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentCapabilities } from "@/lib/agent-policy";
import { isCommandAllowed } from "@/lib/agent-policy";
import {
  getEffectiveCapabilitiesForTarget,
  isTargetEnabled,
} from "@/lib/server-policy-store";
import type { SshHost } from "./types";
import { getSshHost } from "./store";

export type SshExecResult = {
  ok: boolean;
  stdout: string;
  error?: string;
};

function resolveKeyPath(keyPath: string): string {
  const expanded = keyPath.startsWith("~/")
    ? path.join(process.env.HOME ?? "", keyPath.slice(2))
    : keyPath;
  return path.resolve(expanded);
}

export function assertSshHostAllowed(
  hostId: string,
  caps?: AgentCapabilities,
): { ok: true; host: SshHost; caps: AgentCapabilities } | { ok: false; reason: string } {
  if (!isTargetEnabled(hostId)) {
    return { ok: false, reason: "该主机未在「权限」中单独授权" };
  }
  const effective = caps ?? getEffectiveCapabilitiesForTarget(hostId);
  if (!effective.canUseSsh) {
    return { ok: false, reason: "该主机未授权远程访问" };
  }
  const host = getSshHost(hostId);
  if (!host) {
    return { ok: false, reason: "SSH 主机不存在" };
  }
  const key = resolveKeyPath(host.privateKeyPath);
  if (!fs.existsSync(key)) {
    return { ok: false, reason: `私钥文件不存在: ${host.privateKeyPath}` };
  }
  return { ok: true, host, caps: effective };
}

/** 通过 OpenSSH 在远程执行只读命令（不支持 shell 管道） */
export function sshExecRemote(
  host: SshHost,
  command: string,
  caps: AgentCapabilities,
): SshExecResult {
  const trimmed = command.trim();
  /** SSH 监控：在 canUseSsh 下允许 allowedCommands 内只读命令，不要求单独开启 canRunCommands */
  const cmdCaps = caps.canRunCommands
    ? caps
    : { ...caps, canRunCommands: true };
  const cmdCheck = isCommandAllowed(trimmed, cmdCaps);
  if (!cmdCheck.allowed) {
    return { ok: false, stdout: "", error: cmdCheck.reason };
  }

  if (/[|;`$()]/.test(trimmed)) {
    return { ok: false, stdout: "", error: "远程命令不允许 shell 元字符" };
  }

  const argvParts = trimmed.split(/\s+/);
  const key = resolveKeyPath(host.privateKeyPath);
  const destination = `${host.username}@${host.host}`;

  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=20",
    "-p",
    String(host.port),
    "-i",
    key,
    destination,
    ...argvParts,
  ];

  const res = spawnSync("ssh", sshArgs, {
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 512 * 1024,
  });

  if (res.error) {
    return { ok: false, stdout: "", error: res.error.message };
  }

  const out = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  if (res.status !== 0) {
    return {
      ok: false,
      stdout: out,
      error: out || `ssh 退出码 ${res.status}`,
    };
  }
  return { ok: true, stdout: out };
}

export function sshExecRemoteById(
  hostId: string,
  command: string,
  caps?: AgentCapabilities,
): SshExecResult {
  const gate = assertSshHostAllowed(hostId, caps);
  if (!gate.ok) {
    return { ok: false, stdout: "", error: gate.reason };
  }
  return sshExecRemote(gate.host, command, gate.caps);
}
