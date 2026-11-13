import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAction } from "@/lib/agent-policy";
import {
  analyzeAllServers,
  analyzeCurrentServer,
  analyzeTarget,
  createErrorReport,
  type AnalysisTarget,
} from "@/lib/server-analyze";
import {
  appendServerReport,
  deleteServerReports,
  listServerReports,
} from "@/lib/server-report-store";
import {
  getEffectiveCapabilitiesForTarget,
  isTargetEnabled,
} from "@/lib/server-policy-store";
import { getSshHost } from "@/lib/ssh/store";

export const runtime = "nodejs";

const postSchema = z.object({
  scope: z.enum(["local", "fleet", "host"]).default("fleet"),
  hostId: z.string().optional(),
});

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export async function GET() {
  return NextResponse.json({ reports: listServerReports() });
}

export async function DELETE(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "需要 JSON body：{ ids: string[] }" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const removed = deleteServerReports(parsed.data.ids);
  return NextResponse.json({ removed, reports: listServerReports() });
}

export async function POST(request: Request) {
  let body: z.infer<typeof postSchema> = { scope: "fleet" };
  try {
    const json = await request.json();
    const parsed = postSchema.safeParse(json);
    if (parsed.success) body = parsed.data;
  } catch {
    // empty body → fleet
  }

  if (body.scope === "local") {
    if (!isTargetEnabled("local")) {
      return NextResponse.json({ error: "本机未在「权限」中授权" }, { status: 403 });
    }
    const caps = getEffectiveCapabilitiesForTarget("local");
    const gate = checkAction("analyze", caps);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }
    const report = await analyzeCurrentServer();
    const stored = appendServerReport(report);
    return NextResponse.json({ report: stored });
  }

  if (body.scope === "host") {
    if (!body.hostId) {
      return NextResponse.json({ error: "缺少 hostId" }, { status: 400 });
    }
    if (!isTargetEnabled(body.hostId)) {
      return NextResponse.json({ error: "该主机未在「权限」中单独授权" }, { status: 403 });
    }
    const caps = getEffectiveCapabilitiesForTarget(body.hostId);
    const gate = checkAction("analyze", caps);
    if (!gate.allowed) {
      return NextResponse.json({ error: gate.reason }, { status: 403 });
    }
    const h = getSshHost(body.hostId);
    const target: AnalysisTarget = {
      type: "ssh",
      hostId: body.hostId,
      label: h?.name ?? body.hostId,
    };
    try {
      const report = await analyzeTarget(target);
      const stored = appendServerReport(report);
      return NextResponse.json({ report: stored });
    } catch (e) {
      const errReport = createErrorReport(target, e);
      const stored = appendServerReport(errReport);
      return NextResponse.json({ report: stored, partial: true });
    }
  }

  const fleet = await analyzeAllServers();
  const stored = fleet.reports.map((r) => appendServerReport(r));
  return NextResponse.json({
    batchId: fleet.batchId,
    ok: fleet.ok,
    failed: fleet.failed,
    reports: stored,
  });
}
