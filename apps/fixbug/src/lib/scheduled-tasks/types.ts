import { z } from "zod";

export const taskKindSchema = z.enum([
  "analyze_fleet",
  "analyze_local",
  "analyze_host",
  "command_local",
  "command_ssh",
]);

export const scheduledTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  /** 给人看的说明，不参与执行逻辑 */
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  /** 标准 5 段 cron，如 `0 8 * * *` */
  cron: z.string().min(9).max(64),
  timezone: z.string().default("Asia/Shanghai"),
  kind: taskKindSchema,
  targetHostId: z.string().optional(),
  command: z.string().max(512).optional(),
  /** 定时执行命令时视为已审批（无人值守）；请仅用于只读巡检命令 */
  unattended: z.boolean().default(false),
  lastRunAt: z.string().optional(),
  lastStatus: z.enum(["ok", "error", "skipped"]).optional(),
  lastMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export type TaskRunLog = {
  id: string;
  taskId: string;
  taskName: string;
  trigger: "cron" | "manual";
  startedAt: string;
  status: "ok" | "error";
  message: string;
};

export const createTaskInputSchema = scheduledTaskSchema.omit({
  id: true,
  lastRunAt: true,
  lastStatus: true,
  lastMessage: true,
  createdAt: true,
  updatedAt: true,
});
