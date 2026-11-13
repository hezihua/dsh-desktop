import fs from "node:fs";
import path from "node:path";
import { fixbugDataDir } from "@/lib/data-root";
import { createId } from "@/lib/id";
import { parseSshConfigToHosts } from "./parse-config";
import { sshHostSchema, type SshHost, type SshHostPublic } from "./types";

const dataDir = fixbugDataDir();
const storePath =
  process.env.SSH_HOSTS_PATH ?? path.join(dataDir, "ssh-hosts.json");
const defaultConfigPath = path.join(dataDir, "ssh-hosts.conf");

export type SshHostSource = "config" | "manual";

export type SshHostPublicView = SshHostPublic & {
  source: SshHostSource;
};

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function resolveSshConfigPaths(): string[] {
  const paths: string[] = [];
  const fromEnv = process.env.SERVER_SSH_CONFIG?.trim();
  if (fromEnv) paths.push(fromEnv);
  paths.push(defaultConfigPath);
  const userConfig = path.join(process.env.HOME ?? "", ".ssh", "config");
  if (!fromEnv && fs.existsSync(userConfig)) {
    paths.push(userConfig);
  }
  return [...new Set(paths.map((p) => path.resolve(p)))];
}

/** UI 保存/编辑始终写入 data/ssh-hosts.conf，避免误覆盖 ~/.ssh/config */
export function getEditableConfigPath(): string {
  return defaultConfigPath;
}

export function getPrimaryConfigPath(): string {
  return getEditableConfigPath();
}

function readManualHosts(): SshHost[] {
  ensureDir();
  if (!fs.existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as SshHost[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManualHosts(hosts: SshHost[]) {
  ensureDir();
  fs.writeFileSync(storePath, JSON.stringify(hosts, null, 2), "utf8");
}

function readConfigHosts(): SshHost[] {
  const merged = new Map<string, SshHost>();
  for (const configPath of resolveSshConfigPaths()) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const content = fs.readFileSync(configPath, "utf8");
      for (const h of parseSshConfigToHosts(content)) {
        merged.set(h.id, h);
      }
    } catch {
      // skip broken file
    }
  }
  return [...merged.values()];
}

function mergeHosts(): SshHost[] {
  const byId = new Map<string, SshHost>();
  for (const h of readConfigHosts()) byId.set(h.id, h);
  for (const h of readManualHosts()) {
    if (!byId.has(h.id)) byId.set(h.id, h);
  }
  return [...byId.values()];
}

export function listSshHostsPublic(): SshHostPublicView[] {
  const configIds = new Set(readConfigHosts().map((h) => h.id));
  return mergeHosts().map((h) => ({
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    privateKeyPath: h.privateKeyPath,
    source: configIds.has(h.id) ? ("config" as const) : ("manual" as const),
  }));
}

export function getSshHost(id: string): SshHost | null {
  return mergeHosts().find((h) => h.id === id) ?? null;
}

export function upsertSshHost(
  input: Omit<SshHost, "id"> & { id?: string },
): SshHost {
  const id = input.id ?? createId("ssh");
  const host = sshHostSchema.parse({ ...input, id });
  const all = readManualHosts().filter((h) => h.id !== id);
  all.push(host);
  writeManualHosts(all);
  return host;
}

export function deleteSshHost(id: string): boolean {
  const configIds = new Set(readConfigHosts().map((h) => h.id));
  if (configIds.has(id)) return false;
  const all = readManualHosts();
  const next = all.filter((h) => h.id !== id);
  if (next.length === all.length) return false;
  writeManualHosts(next);
  return true;
}

export function readEditableConfigFile(): {
  path: string;
  exists: boolean;
  content: string;
} {
  const configPath = getEditableConfigPath();
  ensureDir();
  if (!fs.existsSync(configPath)) {
    const examplePath = path.join(process.cwd(), "config", "ssh-hosts.example.conf");
    const content = fs.existsSync(examplePath)
      ? fs.readFileSync(examplePath, "utf8")
      : "";
    return { path: configPath, exists: false, content };
  }
  return {
    path: configPath,
    exists: true,
    content: fs.readFileSync(configPath, "utf8"),
  };
}

export function writeConfigFile(content: string): {
  path: string;
  count: number;
} {
  const configPath = getEditableConfigPath();
  ensureDir();
  fs.writeFileSync(configPath, content, "utf8");
  const hosts = parseSshConfigToHosts(content);
  return { path: configPath, count: hosts.length };
}

export function syncFromConfigFiles(): {
  loaded: number;
  paths: string[];
} {
  const hosts = readConfigHosts();
  return {
    loaded: hosts.length,
    paths: resolveSshConfigPaths().filter((p) => fs.existsSync(p)),
  };
}
