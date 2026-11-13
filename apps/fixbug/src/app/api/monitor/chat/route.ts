import { NextResponse } from "next/server";
import { z } from "zod";
import { isHarnessConfigured } from "@/lib/dsh/config";
import { getLlmBackend, getMonitorModelId, isLlmConfigured } from "@/lib/llm-model";
import { runMonitorAgent } from "@/lib/server-monitor/agent";

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(40),
  /** 空或不传 = 本机；否则为 SSH 主机 id */
  targetHostId: z.string().min(1).nullable().optional(),
  harnessSessionId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "messages 格式错误", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await runMonitorAgent(parsed.data.messages, {
    targetHostId: parsed.data.targetHostId ?? null,
    harnessSessionId: parsed.data.harnessSessionId ?? null,
  });
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    usage: "POST { messages, targetHostId? }",
    harness: isHarnessConfigured(),
    harnessUrl: process.env.HARNESS_URL?.trim() || null,
    llm: isLlmConfigured(),
    backend: getLlmBackend(),
    model: getMonitorModelId(),
    locale: process.env.NEXT_PUBLIC_UI_LOCALE === "zh" ? "zh" : process.env.NEXT_PUBLIC_UI_LOCALE === "en" ? "en" : null,
  });
}
