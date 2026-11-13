import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listSkillSummaries,
  matchSkills,
  writeSkill,
} from "@/lib/skills";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "name 仅小写字母、数字、连字符"),
  description: z.string().min(1).max(500),
  triggers: z.array(z.string().max(80)).max(30).default([]),
  body: z.string().min(1).max(50000),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const skills = listSkillSummaries();

  if (q) {
    const matched = matchSkills(q, 10).map(({ body: _b, ...m }) => m);
    return NextResponse.json({ skills, matched });
  }

  return NextResponse.json({
    skills,
    location: ".agent/skills/",
  });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const skill = writeSkill(parsed.data);
    return NextResponse.json({ skill: { ...skill, body: undefined, bodyPreview: skill.body.slice(0, 200) } }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "写入失败" },
      { status: 500 },
    );
  }
}
