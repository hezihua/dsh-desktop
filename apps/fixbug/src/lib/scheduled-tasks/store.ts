import fs from "node:fs";
import path from "node:path";
import { fixbugDataDir } from "@/lib/data-root";
import { createId } from "@/lib/id";
import {
  scheduledTaskSchema,
  type ScheduledTask,
  type TaskRunLog,
} from "./types";

const tasksPath =
  process.env.SCHEDULED_TASKS_PATH ??
  path.join(fixbugDataDir(), "scheduled-tasks.json");
const runsPath =
  process.env.TASK_RUNS_PATH ?? path.join(fixbugDataDir(), "task-runs.json");

const MAX_RUNS = 200;

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function ensureDataDir() {
  const dir = path.dirname(tasksPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readTasks(): ScheduledTask[] {
  ensureDataDir();
  if (!fs.existsSync(tasksPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(tasksPath, "utf8")) as ScheduledTask[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: ScheduledTask[]) {
  ensureDataDir();
  fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2), "utf8");
}

function readRuns(): TaskRunLog[] {
  ensureDataDir();
  if (!fs.existsSync(runsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(runsPath, "utf8")) as TaskRunLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRuns(runs: TaskRunLog[]) {
  ensureDataDir();
  fs.writeFileSync(runsPath, JSON.stringify(runs, null, 2), "utf8");
}

export function listScheduledTasks(): ScheduledTask[] {
  return readTasks().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getScheduledTask(id: string): ScheduledTask | null {
  return readTasks().find((t) => t.id === id) ?? null;
}

export function createScheduledTask(
  input: Omit<
    ScheduledTask,
    "id" | "lastRunAt" | "lastStatus" | "lastMessage" | "createdAt" | "updatedAt"
  >,
): ScheduledTask {
  const now = ts();
  const task = scheduledTaskSchema.parse({
    ...input,
    id: createId("tsk"),
    createdAt: now,
    updatedAt: now,
  });
  writeTasks([task, ...readTasks()]);
  return task;
}

export function updateScheduledTask(
  id: string,
  patch: Partial<ScheduledTask>,
): ScheduledTask | null {
  const all = readTasks();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const next = scheduledTaskSchema.parse({
    ...all[idx],
    ...patch,
    id,
    updatedAt: ts(),
  });
  all[idx] = next;
  writeTasks(all);
  return next;
}

export function deleteScheduledTask(id: string): boolean {
  const all = readTasks();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  writeTasks(next);
  return true;
}

export function appendTaskRun(log: Omit<TaskRunLog, "id">): TaskRunLog {
  const row: TaskRunLog = { ...log, id: createId("run") };
  writeRuns([row, ...readRuns()].slice(0, MAX_RUNS));
  return row;
}

export function listTaskRuns(taskId?: string, limit = 30): TaskRunLog[] {
  let runs = readRuns();
  if (taskId) runs = runs.filter((r) => r.taskId === taskId);
  return runs.slice(0, limit);
}

export function patchTaskLastRun(
  id: string,
  status: ScheduledTask["lastStatus"],
  message: string,
) {
  updateScheduledTask(id, {
    lastRunAt: ts(),
    lastStatus: status,
    lastMessage: message.slice(0, 2000),
  });
}

/** 首次启动：每日 8:00 对本机 + 全部 SSH 主机生成分析报告 */
export function ensureDefaultScheduledTasks(): ScheduledTask | null {
  const all = readTasks();
  if (all.some((t) => t.kind === "analyze_fleet")) return null;

  return createScheduledTask({
    name: "每日 08:00 全量服务器分析报告",
    description:
      "对本机与全部已登记 SSH 主机各生成一份分析报告；未授权或连接失败也会写入分析列表。",
    enabled: true,
    cron: "0 8 * * *",
    timezone: "Asia/Shanghai",
    kind: "analyze_fleet",
    unattended: false,
  });
}
