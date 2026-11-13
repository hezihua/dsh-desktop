import fs from "node:fs";
import path from "node:path";
import { parseSkillMarkdown, serializeSkillMarkdown } from "./parse-skill-md";
import type { SkillRecord, SkillSummary } from "./types";

const SKILL_FILE = "SKILL.md";

export function agentSkillsRoot() {
  return path.join(process.cwd(), ".agent", "skills");
}

function listSkillDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => path.join(root, d.name));
}

function loadFromDir(root: string): SkillRecord[] {
  const out: SkillRecord[] = [];
  for (const dir of listSkillDirs(root)) {
    const file = path.join(dir, SKILL_FILE);
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, "utf8");
      const { meta, body } = parseSkillMarkdown(raw, file, "agent", false);
      out.push({ ...meta, body });
    } catch {
      // skip broken skill
    }
  }
  return out;
}

export function loadAllSkills(): SkillRecord[] {
  return loadFromDir(agentSkillsRoot()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function listSkillSummaries(): SkillSummary[] {
  return loadAllSkills().map(({ body: _b, ...rest }) => rest);
}

export function getSkillByName(name: string): SkillRecord | null {
  return loadAllSkills().find((s) => s.name === name) ?? null;
}

export function ensureAgentSkillsDir() {
  const dir = agentSkillsRoot();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeSkill(input: {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}): SkillRecord {
  const safeName = input.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  if (!safeName) throw new Error("无效 skill 名称");

  ensureAgentSkillsDir();
  const dir = path.join(agentSkillsRoot(), safeName);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SKILL_FILE);
  const content = serializeSkillMarkdown({ ...input, name: safeName });
  fs.writeFileSync(file, content, "utf8");

  const skill = loadAllSkills().find((s) => s.name === safeName);
  if (!skill) throw new Error("写入后未能加载 skill");
  return skill;
}

export function deleteAgentSkill(name: string): boolean {
  const skill = getSkillByName(name);
  if (!skill || skill.readonly) return false;

  const dir = path.join(agentSkillsRoot(), name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
