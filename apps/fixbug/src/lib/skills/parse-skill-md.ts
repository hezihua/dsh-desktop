import type { SkillMeta } from "./types";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function lineValue(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "im");
  const m = block.match(re);
  return m?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

function parseTriggers(block: string): string[] {
  const listMatch = block.match(/^triggers:\s*\n((?:\s*-\s*.+\n?)+)/im);
  if (listMatch) {
    return listMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }
  const inline = lineValue(block, "triggers");
  if (inline) {
    return inline.split(/[,，|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function parseSkillMarkdown(
  raw: string,
  filePath: string,
  source: SkillMeta["source"],
  readonly: boolean,
): { meta: SkillMeta; body: string } {
  const match = raw.match(FRONTMATTER);
  const front = match?.[1] ?? "";
  const body = (match?.[2] ?? raw).trim();

  const dirName = filePath.split(/[/\\]/).slice(-2, -1)[0] ?? "unnamed";
  const name = lineValue(front, "name") ?? dirName;
  const description =
    lineValue(front, "description") ?? "未提供 description";
  const triggers = parseTriggers(front);
  const readonlyFm = lineValue(front, "readonly");
  const readonlyFlag =
    readonlyFm === "true"
      ? true
      : readonlyFm === "false"
        ? false
        : readonly;

  return {
    meta: {
      name,
      description,
      triggers,
      source,
      path: filePath,
      readonly: readonlyFlag,
    },
    body,
  };
}

export function serializeSkillMarkdown(meta: {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}): string {
  const triggersBlock =
    meta.triggers.length > 0
      ? `triggers:\n${meta.triggers.map((t) => `  - ${t}`).join("\n")}\n`
      : "";
  return `---
name: ${meta.name}
description: ${meta.description}
${triggersBlock}---

${meta.body.trim()}
`;
}
