import { NextResponse } from "next/server";
import { executeScheduledTask } from "@/lib/scheduled-tasks/executor";
import { getScheduledTask } from "@/lib/scheduled-tasks/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!getScheduledTask(id)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const result = await executeScheduledTask(id, "manual");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
