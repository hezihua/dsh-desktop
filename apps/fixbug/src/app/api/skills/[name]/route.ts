import { NextResponse } from "next/server";
import { deleteAgentSkill, getSkillByName } from "@/lib/skills";

export const runtime = "nodejs";

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { name } = await params;
  const skill = getSkillByName(name);
  if (!skill) {
    return NextResponse.json({ error: "Skill 不存在" }, { status: 404 });
  }
  return NextResponse.json({ skill });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { name } = await params;
  const skill = getSkillByName(name);
  if (!skill) {
    return NextResponse.json({ error: "Skill 不存在" }, { status: 404 });
  }
  if (skill.readonly) {
    return NextResponse.json(
      { error: "只读 Skill 不可删除（frontmatter readonly: true）" },
      { status: 403 },
    );
  }
  if (!deleteAgentSkill(name)) {
    return NextResponse.json(
      { error: "仅可删除 .agent/skills/ 下非只读 Skill" },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true });
}
