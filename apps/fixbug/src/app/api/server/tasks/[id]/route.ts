import { NextResponse } from "next/server";
import cron from "node-cron";
import { z } from "zod";
import { reloadTaskScheduler } from "@/lib/scheduled-tasks/scheduler";
import {
  deleteScheduledTask,
  getScheduledTask,
  updateScheduledTask,
} from "@/lib/scheduled-tasks/store";
import { taskKindSchema } from "@/lib/scheduled-tasks/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    cron: z.string().min(9).max(64).optional(),
    timezone: z.string().optional(),
    kind: taskKindSchema.optional(),
    targetHostId: z.string().nullable().optional(),
    command: z.string().max(512).nullable().optional(),
    unattended: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.cron && !cron.validate(val.cron)) {
      ctx.addIssue({ code: "custom", message: "cron 无效", path: ["cron"] });
    }
  });

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!getScheduledTask(id)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { targetHostId, command, ...rest } = parsed.data;
  const patch = {
    ...rest,
    ...(targetHostId === null ? {} : targetHostId !== undefined ? { targetHostId } : {}),
    ...(command === null ? {} : command !== undefined ? { command } : {}),
  };

  const task = updateScheduledTask(id, patch);
  const reload = reloadTaskScheduler();
  return NextResponse.json({ task, scheduler: reload });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!deleteScheduledTask(id)) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const reload = reloadTaskScheduler();
  return NextResponse.json({ ok: true, scheduler: reload });
}
