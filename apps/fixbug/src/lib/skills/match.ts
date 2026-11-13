import { loadAllSkills } from "./registry";
import type { SkillRecord } from "./types";

function normalize(text: string) {
  return text.toLowerCase();
}

function scoreSkill(skill: SkillRecord, text: string): number {
  const t = normalize(text);
  let score = 0;

  if (t.includes(normalize(skill.name))) score += 8;
  if (normalize(skill.description).split(/\s+/).some((w) => w.length > 2 && t.includes(w))) {
    score += 2;
  }

  for (const trigger of skill.triggers) {
    const tr = normalize(trigger);
    if (!tr) continue;
    if (t.includes(tr)) score += 5;
  }

  return score;
}

/** 按用户问题或报告文本匹配最相关的 Skill（按需注入 Agent） */
export function matchSkills(text: string, limit = 3): SkillRecord[] {
  const skills = loadAllSkills();
  if (!skills.length) return [];

  return skills
    .map((s) => ({ s, score: scoreSkill(s, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

export function formatSkillsForSystemPrompt(skills: SkillRecord[]): string {
  if (!skills.length) return "";
  const blocks = skills.map(
    (s) =>
      `### Skill: ${s.name}\n${s.description}\n\n${s.body.slice(0, 4000)}`,
  );
  return [
    "",
    "## 已加载的 Agent Skills（按当前问题匹配，请遵循其排查步骤）",
    ...blocks,
    "",
    "仍须遵守：禁止 sudo、禁止写文件与重启服务，仅只读运维。",
  ].join("\n");
}
