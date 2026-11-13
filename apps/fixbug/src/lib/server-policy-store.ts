import fs from "node:fs";
import path from "node:path";
import { fixbugDataDir } from "@/lib/data-root";
import {
  agentCapabilitiesSchema,
  parseCapabilities,
  type AgentCapabilities,
} from "@/lib/agent-policy";
import { listSshHostsPublic } from "@/lib/ssh/store";
import {
  defaultServerPolicyDocument,
  defaultTargetGrant,
  mergeGrantWithShared,
  migrateLegacyCapabilities,
  serverPolicyDocumentSchema,
  type ServerPolicyDocument,
  type TargetGrant,
} from "@/lib/server-target-policy";

const policyPath =
  process.env.SERVER_AGENT_POLICY_PATH ??
  path.join(fixbugDataDir(), "server-agent-policy.json");

function ensureDataDir() {
  const dir = path.dirname(policyPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readRawJson(): unknown {
  ensureDataDir();
  if (!fs.existsSync(policyPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch {
    return null;
  }
}

function parsePolicyDocument(raw: unknown): ServerPolicyDocument {
  if (!raw || typeof raw !== "object") {
    return defaultServerPolicyDocument();
  }
  const obj = raw as Record<string, unknown>;
  if ("local" in obj && "shared" in obj) {
    const parsed = serverPolicyDocumentSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  const legacy = parseCapabilities(JSON.stringify(raw));
  let doc = migrateLegacyCapabilities(legacy);
  if (legacy.canUseSsh && legacy.allowedSshHostIds.length === 0) {
    const hosts = { ...doc.hosts };
    for (const h of listSshHostsPublic()) {
      if (hosts[h.id]) continue;
      hosts[h.id] = defaultTargetGrant({
        enabled: true,
        canAnalyze: true,
        canRunCommands: legacy.canRunCommands,
        requireHumanApproval: legacy.requireHumanApproval,
        maxAutoFixRisk: legacy.maxAutoFixRisk,
        allowedCommands: legacy.allowedCommands,
      });
    }
    doc = { ...doc, hosts };
  }
  return doc;
}

export function getServerPolicyDocument(): ServerPolicyDocument {
  return parsePolicyDocument(readRawJson());
}

export function saveServerPolicyDocument(doc: ServerPolicyDocument) {
  const parsed = serverPolicyDocumentSchema.parse(doc);
  ensureDataDir();
  fs.writeFileSync(policyPath, JSON.stringify(parsed, null, 2), "utf8");
}

export function getTargetGrant(target: "local" | string): TargetGrant {
  const doc = getServerPolicyDocument();
  if (target === "local") return doc.local;
  return doc.hosts[target] ?? defaultTargetGrant({ enabled: false, canAnalyze: true });
}

export function setTargetGrant(target: "local" | string, grant: TargetGrant) {
  const doc = getServerPolicyDocument();
  const parsed = serverPolicyDocumentSchema.shape.local.parse(grant);
  if (target === "local") {
    saveServerPolicyDocument({ ...doc, local: parsed });
  } else {
    saveServerPolicyDocument({
      ...doc,
      hosts: { ...doc.hosts, [target]: parsed },
    });
  }
}

export function getSharedCapabilities(): AgentCapabilities {
  return getServerPolicyDocument().shared;
}

/** 本机有效策略（兼容旧调用） */
export function getServerCapabilities(): AgentCapabilities {
  return getEffectiveCapabilitiesForTarget("local");
}

export function getEffectiveCapabilitiesForTarget(
  target: "local" | string,
): AgentCapabilities {
  const doc = getServerPolicyDocument();
  const grant = target === "local" ? doc.local : getTargetGrant(target);
  return mergeGrantWithShared(doc.shared, grant, {
    remote: target !== "local",
  });
}

export function isTargetEnabled(target: "local" | string): boolean {
  return getTargetGrant(target).enabled;
}

export function saveServerCapabilities(capabilities: AgentCapabilities) {
  const doc = getServerPolicyDocument();
  const shared = agentCapabilitiesSchema.parse({
    ...capabilities,
    canAnalyze: false,
    canReadRepo: false,
    canProposePatch: false,
    canApplyLocalFix: false,
    canRunCommands: false,
    canUseSsh: false,
    allowedSshHostIds: [],
    canOpenPr: false,
  });
  const local = {
    ...doc.local,
    enabled: capabilities.canAnalyze,
    canAnalyze: capabilities.canAnalyze,
    canReadRepo: capabilities.canReadRepo,
    canProposePatch: capabilities.canProposePatch,
    canApplyLocalFix: capabilities.canApplyLocalFix,
    canRunCommands: capabilities.canRunCommands,
    requireHumanApproval: capabilities.requireHumanApproval,
    maxAutoFixRisk: capabilities.maxAutoFixRisk,
    allowedPaths: capabilities.allowedPaths,
    allowedCommands: capabilities.allowedCommands,
  };
  saveServerPolicyDocument({ ...doc, shared, local });
}
