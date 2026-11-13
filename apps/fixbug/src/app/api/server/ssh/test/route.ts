import { NextResponse } from "next/server";
import { z } from "zod";
import { getEffectiveCapabilitiesForTarget } from "@/lib/server-policy-store";
import { testSshHost } from "@/lib/server-monitor/remote-collect";

export const runtime = "nodejs";

const bodySchema = z.object({
  hostId: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    const caps = getEffectiveCapabilitiesForTarget(parsed.data.hostId);
    const output = testSshHost(parsed.data.hostId, caps);
    return NextResponse.json({ ok: true, output });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
