import { z } from "zod";

/**
 * Agent 权限模型（默认安全）：
 * - 永远禁止 sudo / 提权 / 写系统目录
 * - 默认只允许「分析」；真正改代码需显式打开且需人工审批
 */
export const agentCapabilitiesSchema = z.object({
  canAnalyze: z.boolean().default(true),
  canReadRepo: z.boolean().default(false),
  canProposePatch: z.boolean().default(false),
  canOpenPr: z.boolean().default(false),
  /** 本地直接改文件 — 默认关，且仍受路径白名单约束 */
  canApplyLocalFix: z.boolean().default(false),
  /** 运行任意 shell — 默认关；即便打开也绝不能 sudo */
  canRunCommands: z.boolean().default(false),
  /** 通过 SSH 访问已登记远程主机（命令仍受 allowedCommands 约束） */
  canUseSsh: z.boolean().default(false),
  /** 允许 SSH 的主机 id；空数组表示全部已登记主机 */
  allowedSshHostIds: z.array(z.string()).default([]),
  requireHumanApproval: z.boolean().default(true),
  maxAutoFixRisk: z.enum(["none", "low", "medium"]).default("none"),
  allowedPaths: z.array(z.string()).default(["src/**", "app/**", "lib/**"]),
  deniedPaths: z
    .array(z.string())
    .default([
      ".env*",
      "**/.env*",
      "**/secrets/**",
      "**/*credential*",
      "**/node_modules/**",
      "/etc/**",
      "/usr/**",
      "/var/**",
      "/root/**",
    ]),
  /** 显式允许的命令前缀（仅当 canRunCommands=true） */
  allowedCommands: z.array(z.string()).default(["npm test", "pnpm test", "npm run lint"]),
  /** 硬拒绝（不可配置去掉的核心项会在运行时合并） */
  deniedCommands: z
    .array(z.string())
    .default([
      "sudo",
      "su",
      "doas",
      "pkexec",
      "chmod",
      "chown",
      "chgrp",
      "mount",
      "umount",
      "mkfs",
      "dd",
      "shutdown",
      "reboot",
      "useradd",
      "userdel",
      "passwd",
      "visudo",
      "iptables",
      "nft",
      "systemctl",
      "service",
      "docker",
      "kubectl",
      "curl|bash",
      "wget|sh",
    ]),
});

export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

/** 不可关闭的硬拒绝前缀 */
export const HARD_DENIED_COMMAND_PREFIXES = [
  "sudo",
  "su ",
  "su\t",
  "doas",
  "pkexec",
  "chmod",
  "chown",
  "chgrp",
  "mount",
  "umount",
  "mkfs",
  "dd ",
  "shutdown",
  "reboot",
  "passwd",
  "visudo",
  "iptables",
  "nft ",
  "systemctl",
] as const;

export function defaultCapabilities(): AgentCapabilities {
  return agentCapabilitiesSchema.parse({});
}

export function parseCapabilities(raw: string | null | undefined): AgentCapabilities {
  if (!raw) return defaultCapabilities();
  try {
    return agentCapabilitiesSchema.parse(JSON.parse(raw));
  } catch {
    return defaultCapabilities();
  }
}

export type AgentAction =
  | "analyze"
  | "read_repo"
  | "propose_patch"
  | "open_pr"
  | "apply_local_fix"
  | "run_command";

export type PermissionDecision = {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
};

function matchGlob(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export function isPathAllowed(
  filePath: string,
  caps: AgentCapabilities,
): PermissionDecision {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const denied of caps.deniedPaths) {
    if (matchGlob(denied, normalized) || matchGlob(denied, `/${normalized}`)) {
      return {
        allowed: false,
        reason: `路径在拒绝列表中: ${denied}`,
        requiresApproval: true,
      };
    }
  }
  if (!caps.allowedPaths.length) {
    return { allowed: false, reason: "未配置允许路径", requiresApproval: true };
  }
  const ok = caps.allowedPaths.some(
    (p) => matchGlob(p, normalized) || matchGlob(`**/${p}`, normalized),
  );
  if (!ok) {
    return {
      allowed: false,
      reason: `路径不在白名单: ${normalized}`,
      requiresApproval: true,
    };
  }
  return {
    allowed: true,
    reason: "路径在白名单内",
    requiresApproval: caps.requireHumanApproval,
  };
}

export function isCommandAllowed(
  command: string,
  caps: AgentCapabilities,
): PermissionDecision {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();

  // 硬拒绝：永远不能 sudo / 提权
  for (const prefix of HARD_DENIED_COMMAND_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix) || lower.includes(` ${prefix}`)) {
      return {
        allowed: false,
        reason: `硬拒绝危险命令（含 sudo/提权类）: ${prefix.trim()}`,
        requiresApproval: true,
      };
    }
  }

  if (/(\||;|&&|`|\$\()/.test(trimmed) && /sudo|su\b|curl|wget|bash|sh\b/.test(lower)) {
    return {
      allowed: false,
      reason: "拒绝管道/链式调用中的高危命令",
      requiresApproval: true,
    };
  }

  for (const denied of caps.deniedCommands) {
    const d = denied.toLowerCase();
    if (d.includes("|")) {
      const parts = d.split("|").map((p) => p.trim());
      if (parts.every((p) => lower.includes(p))) {
        return {
          allowed: false,
          reason: `命令匹配拒绝模式: ${denied}`,
          requiresApproval: true,
        };
      }
    } else if (lower === d || lower.startsWith(`${d} `) || lower.includes(` ${d} `)) {
      return {
        allowed: false,
        reason: `命令在拒绝列表: ${denied}`,
        requiresApproval: true,
      };
    }
  }

  if (!caps.canRunCommands) {
    return {
      allowed: false,
      reason: "策略未开启 canRunCommands",
      requiresApproval: true,
    };
  }

  const allowed = caps.allowedCommands.some((a) => {
    const prefix = a.toLowerCase();
    return lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(prefix);
  });

  if (!allowed) {
    return {
      allowed: false,
      reason: "命令不在允许列表",
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    reason: "命令在白名单内",
    requiresApproval: caps.requireHumanApproval,
  };
}

export function checkAction(
  action: AgentAction,
  caps: AgentCapabilities,
  opts?: { path?: string; command?: string; risk?: "low" | "medium" | "high" | "critical" },
): PermissionDecision {
  switch (action) {
    case "analyze":
      if (!caps.canAnalyze) {
        return { allowed: false, reason: "未授权分析", requiresApproval: false };
      }
      return { allowed: true, reason: "允许分析", requiresApproval: false };

    case "read_repo":
      if (!caps.canReadRepo) {
        return { allowed: false, reason: "未授权读取仓库", requiresApproval: true };
      }
      return {
        allowed: true,
        reason: "允许读仓库",
        requiresApproval: caps.requireHumanApproval,
      };

    case "propose_patch":
      if (!caps.canProposePatch) {
        return { allowed: false, reason: "未授权生成补丁", requiresApproval: true };
      }
      if (opts?.path) {
        const pathCheck = isPathAllowed(opts.path, caps);
        if (!pathCheck.allowed) return pathCheck;
      }
      return {
        allowed: true,
        reason: "允许提出补丁（需审批后才可落地）",
        requiresApproval: true,
      };

    case "open_pr":
      if (!caps.canOpenPr) {
        return { allowed: false, reason: "未授权创建 PR", requiresApproval: true };
      }
      return {
        allowed: true,
        reason: "允许开 PR",
        requiresApproval: caps.requireHumanApproval,
      };

    case "apply_local_fix": {
      if (!caps.canApplyLocalFix) {
        return { allowed: false, reason: "未授权本地写文件", requiresApproval: true };
      }
      const risk = opts?.risk ?? "medium";
      if (caps.maxAutoFixRisk === "none") {
        return {
          allowed: false,
          reason: "maxAutoFixRisk=none，禁止自动落盘",
          requiresApproval: true,
        };
      }
      if (risk === "high" || risk === "critical") {
        return {
          allowed: false,
          reason: "高风险变更禁止自动应用",
          requiresApproval: true,
        };
      }
      if (risk === "medium" && caps.maxAutoFixRisk === "low") {
        return {
          allowed: false,
          reason: "中风险超出 maxAutoFixRisk=low",
          requiresApproval: true,
        };
      }
      if (opts?.path) {
        const pathCheck = isPathAllowed(opts.path, caps);
        if (!pathCheck.allowed) return pathCheck;
      }
      return {
        allowed: true,
        reason: "允许在白名单路径内应用修复",
        requiresApproval: caps.requireHumanApproval,
      };
    }

    case "run_command":
      if (!opts?.command) {
        return { allowed: false, reason: "未提供命令", requiresApproval: true };
      }
      return isCommandAllowed(opts.command, caps);

    default:
      return { allowed: false, reason: "未知动作", requiresApproval: true };
  }
}
