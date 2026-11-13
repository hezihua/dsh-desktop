import { z } from "zod";
import {
  agentCapabilitiesSchema,
  type AgentCapabilities,
  defaultCapabilities,
} from "@/lib/agent-policy";

/** 单台服务器（本机或 SSH 主机）的授权项 */
export const targetGrantSchema = z.object({
  enabled: z.boolean().default(false),
  canAnalyze: z.boolean().default(true),
  canReadRepo: z.boolean().default(false),
  canProposePatch: z.boolean().default(false),
  canApplyLocalFix: z.boolean().default(false),
  canRunCommands: z.boolean().default(false),
  requireHumanApproval: z.boolean().default(true),
  maxAutoFixRisk: z.enum(["none", "low", "medium"]).default("none"),
  /** 留空则使用全局 shared.allowedPaths */
  allowedPaths: z.array(z.string()).optional(),
  /** 留空则使用全局 shared.allowedCommands */
  allowedCommands: z.array(z.string()).optional(),
});

export type TargetGrant = z.infer<typeof targetGrantSchema>;

export const serverPolicyDocumentSchema = z.object({
  shared: agentCapabilitiesSchema,
  local: targetGrantSchema,
  hosts: z.record(z.string(), targetGrantSchema).default({}),
});

export type ServerPolicyDocument = z.infer<typeof serverPolicyDocumentSchema>;

export function defaultTargetGrant(partial?: Partial<TargetGrant>): TargetGrant {
  return targetGrantSchema.parse(partial ?? {});
}

export function defaultSharedCapabilities(): AgentCapabilities {
  return agentCapabilitiesSchema.parse({
    ...defaultCapabilities(),
    canAnalyze: true,
    canReadRepo: true,
    canProposePatch: false,
    canOpenPr: false,
    canApplyLocalFix: false,
    canRunCommands: false,
    canUseSsh: false,
    allowedSshHostIds: [],
    requireHumanApproval: true,
    maxAutoFixRisk: "none",
    allowedPaths: [
      "src/**",
      "app/**",
      "lib/**",
      "/etc/nginx/**",
      "/etc/systemd/system/**",
    ],
    allowedCommands: [
      "df -h",
      "free -h",
      "journalctl",
      "journalctl -n 50 --no-pager",
      "du -sh /var/log",
      "ps aux --sort=-%mem",
      "uname -a",
      "uptime",
      "tail",
      "cat",
      "pnpm test",
      "npm test",
    ],
  });
}

export function defaultServerPolicyDocument(): ServerPolicyDocument {
  return {
    shared: defaultSharedCapabilities(),
    local: defaultTargetGrant({
      enabled: true,
      canAnalyze: true,
      canReadRepo: true,
    }),
    hosts: {},
  };
}

function grantFromLegacyCapabilities(cap: AgentCapabilities): TargetGrant {
  return targetGrantSchema.parse({
    enabled: cap.canAnalyze,
    canAnalyze: cap.canAnalyze,
    canReadRepo: cap.canReadRepo,
    canProposePatch: cap.canProposePatch,
    canApplyLocalFix: cap.canApplyLocalFix,
    canRunCommands: cap.canRunCommands,
    requireHumanApproval: cap.requireHumanApproval,
    maxAutoFixRisk: cap.maxAutoFixRisk,
    allowedPaths: cap.allowedPaths,
    allowedCommands: cap.allowedCommands,
  });
}

/** 旧版单文件 capabilities → 新文档结构 */
export function migrateLegacyCapabilities(cap: AgentCapabilities): ServerPolicyDocument {
  const shared = agentCapabilitiesSchema.parse({
    ...cap,
    canAnalyze: false,
    canReadRepo: false,
    canProposePatch: false,
    canApplyLocalFix: false,
    canRunCommands: false,
    canUseSsh: false,
    allowedSshHostIds: [],
    canOpenPr: false,
  });

  const local = grantFromLegacyCapabilities(cap);

  const hosts: Record<string, TargetGrant> = {};
  if (cap.canUseSsh && cap.allowedSshHostIds.length > 0) {
    for (const id of cap.allowedSshHostIds) {
      hosts[id] = targetGrantSchema.parse({
        enabled: true,
        canAnalyze: true,
        canRunCommands: cap.canRunCommands,
        requireHumanApproval: cap.requireHumanApproval,
        maxAutoFixRisk: cap.maxAutoFixRisk,
        allowedCommands: cap.allowedCommands,
      });
    }
  }

  return { shared, local, hosts };
}

export function mergeGrantWithShared(
  shared: AgentCapabilities,
  grant: TargetGrant,
  opts: { remote: boolean },
): AgentCapabilities {
  const enabled = grant.enabled;
  return agentCapabilitiesSchema.parse({
    ...shared,
    canAnalyze: enabled && grant.canAnalyze,
    canReadRepo: enabled && grant.canReadRepo,
    canProposePatch: enabled && grant.canProposePatch,
    canApplyLocalFix: enabled && grant.canApplyLocalFix,
    canRunCommands: enabled && grant.canRunCommands,
    requireHumanApproval: grant.requireHumanApproval,
    maxAutoFixRisk: grant.maxAutoFixRisk,
    allowedPaths:
      grant.allowedPaths && grant.allowedPaths.length > 0
        ? grant.allowedPaths
        : shared.allowedPaths,
    allowedCommands:
      grant.allowedCommands && grant.allowedCommands.length > 0
        ? grant.allowedCommands
        : shared.allowedCommands,
    canUseSsh: opts.remote && enabled,
    allowedSshHostIds: [],
    canOpenPr: false,
  });
}
