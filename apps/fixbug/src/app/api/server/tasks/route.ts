import { NextResponse } from "next/server";
import cron from "node-cron";
import { z } from "zod";
import { reloadTaskScheduler, isSchedulerStarted } from "@/lib/scheduled-tasks/scheduler";
import {
  createScheduledTask,
  ensureDefaultScheduledTasks,
  listScheduledTasks,
  listTaskRuns,
} from "@/lib/scheduled-tasks/store";
import { taskKindSchema } from "@/lib/scheduled-tasks/types";

export const runtime = "nodejs";

const createSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    enabled: z.boolean().default(true),
    cron: z.string().min(9).max(64),
    timezone: z.string().default("Asia/Shanghai"),
    kind: taskKindSchema,
    targetHostId: z.string().optional(),
    command: z.string().max(512).optional(),
    unattended: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (!cron.validate(val.cron)) {
      ctx.addIssue({ code: "custom", message: "cron 表达式无效", path: ["cron"] });
    }
    const commandKinds = ["command_local", "command_ssh"] as const;
    if (commandKinds.includes(val.kind as (typeof commandKinds)[number]) && !val.command?.trim()) {
      ctx.addIssue({ code: "custom", message: "命令任务需要 command", path: ["command"] });
    }
    if (
      (val.kind === "command_ssh" || val.kind === "analyze_host") &&
      !val.targetHostId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "请选择 SSH 主机",
        path: ["targetHostId"],
      });
    }
  });

export async function GET() {
  ensureDefaultScheduledTasks();
  const reload = reloadTaskScheduler();
  return NextResponse.json({
    tasks: listScheduledTasks(),
    runs: listTaskRuns(undefined, 40),
    scheduler: {
      started: isSchedulerStarted(),
      registered: reload.registered,
      invalidCrons: reload.invalid,
    },
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

  const task = createScheduledTask(parsed.data);
  const reload = reloadTaskScheduler();

  return NextResponse.json({ task, scheduler: reload });
}
