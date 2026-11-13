import path from "node:path";

/** 监控 Agent 只读访问策略（与代码修复 Agent 白名单分离） */
const DENIED_FRAGMENTS = [
  ".env",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "shadow",
  "passwd",
  "credentials",
  "secret",
  "/root/",
  "/proc/",
  "/sys/",
  "/dev/",
] as const;

const LOG_PREFIXES = [
  "/var/log/",
  path.join(process.cwd(), "logs") + path.sep,
  path.join(process.cwd(), "data") + path.sep,
] as const;

const CONFIG_PREFIXES = [
  "/etc/hosts",
  "/etc/hostname",
  "/etc/resolv.conf",
  "/etc/nginx/",
  "/etc/systemd/system/",
  path.join(process.cwd(), "next.config.ts"),
  path.join(process.cwd(), "next.config.mjs"),
  path.join(process.cwd(), "next.config.js"),
  path.join(process.cwd(), "package.json"),
  path.join(process.cwd(), "pnpm-workspace.yaml"),
  path.join(process.cwd(), "drizzle.config.ts"),
  path.join(process.cwd(), ".gitignore"),
] as const;

export type PathKind = "log" | "config" | "any";

export function normalizeMonitorPath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (trimmed.startsWith("/")) return path.normalize(trimmed);
  return path.normalize(path.join(process.cwd(), trimmed));
}

function isDenied(normalized: string): string | null {
  const lower = normalized.toLowerCase();
  for (const frag of DENIED_FRAGMENTS) {
    if (lower.includes(frag.toLowerCase())) {
      return frag;
    }
  }
  return null;
}

function matchesPrefix(normalized: string, prefixes: readonly string[]): boolean {
  for (const p of prefixes) {
    const norm = path.normalize(p);
    if (normalized === norm) return true;
    if (norm.endsWith(path.sep) && normalized.startsWith(norm)) return true;
    if (!norm.endsWith(path.sep) && normalized.startsWith(norm + path.sep)) return true;
  }
  return false;
}

export function assertReadablePath(
  input: string,
  kind: PathKind = "any",
): { ok: true; path: string } | { ok: false; reason: string } {
  const normalized = normalizeMonitorPath(input);
  const denied = isDenied(normalized);
  if (denied) {
    return { ok: false, reason: `拒绝访问敏感路径（匹配: ${denied}）` };
  }

  const logOk = matchesPrefix(normalized, LOG_PREFIXES);
  const configOk = matchesPrefix(normalized, CONFIG_PREFIXES);

  if (kind === "log" && !logOk) {
    return {
      ok: false,
      reason: `日志路径不在允许范围。可读: /var/log/**、项目 logs/、data/`,
    };
  }
  if (kind === "config" && !configOk) {
    return {
      ok: false,
      reason: `配置路径不在允许范围。可读: /etc/nginx/**、/etc/systemd/system/**、项目根配置文件等`,
    };
  }
  if (kind === "any" && !logOk && !configOk) {
    return {
      ok: false,
      reason: `路径不在监控白名单内（日志或配置文件）`,
    };
  }

  return { ok: true, path: normalized };
}

export function listMonitorCapabilities(): {
  logs: string[];
  configs: string[];
  notes: string[];
} {
  return {
    logs: ["/var/log/**", "./logs/**", "./data/**"],
    configs: [
      "/etc/nginx/**",
      "/etc/systemd/system/**",
      "/etc/hosts",
      "/etc/hostname",
      "/etc/resolv.conf",
      "项目根: next.config.*、package.json、drizzle.config.ts 等",
    ],
    notes: [
      "只读：不写文件、不 sudo、不执行未白名单命令",
      "结构化体检请使用「分析」页",
      "设置 AI_GATEWAY_API_KEY + MONITOR_AI_MODEL 可启用 LLM 理解自然语言",
    ],
  };
}
