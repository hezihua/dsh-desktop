import type { SshHost } from "./types";

export type ParsedSshBlock = {
  aliases: string[];
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
};

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return `${process.env.HOME ?? ""}/${p.slice(2)}`;
  }
  return p;
}

function hostIdFromAlias(alias: string): string {
  const safe = alias.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `cfg-${safe}`;
}

/** 解析 OpenSSH config 子集（Host / HostName / User / Port / IdentityFile） */
export function parseSshConfigContent(content: string): ParsedSshBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: ParsedSshBlock[] = [];
  let current: ParsedSshBlock | null = null;

  const pushCurrent = () => {
    if (!current?.aliases.length) return;
    blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(\S+)\s+(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (key === "host") {
      pushCurrent();
      const aliases = value.split(/\s+/).filter((a) => a && a !== "*");
      if (!aliases.length) {
        current = null;
        continue;
      }
      current = { aliases };
      continue;
    }

    if (!current) continue;

    if (key === "hostname") current.hostName = value;
    else if (key === "user") current.user = value;
    else if (key === "port") current.port = Number(value) || 22;
    else if (key === "identityfile") current.identityFile = value;
  }
  pushCurrent();
  return blocks;
}

export function blocksToHosts(
  blocks: ParsedSshBlock[],
  defaults?: { user?: string; port?: number; identityFile?: string },
): SshHost[] {
  const hosts: SshHost[] = [];
  for (const block of blocks) {
    const hostName = block.hostName ?? block.aliases[0];
    if (!hostName || hostName.includes("*")) continue;

    const alias = block.aliases[0];
    const user = block.user ?? defaults?.user;
    if (!user) continue;

    const privateKeyPath = expandPath(
      block.identityFile ?? defaults?.identityFile ?? "~/.ssh/id_rsa",
    );

    hosts.push({
      id: hostIdFromAlias(alias),
      name: alias,
      host: hostName,
      port: block.port ?? defaults?.port ?? 22,
      username: user,
      privateKeyPath,
    });
  }
  return hosts;
}

export function parseSshConfigToHosts(content: string): SshHost[] {
  return blocksToHosts(parseSshConfigContent(content));
}
