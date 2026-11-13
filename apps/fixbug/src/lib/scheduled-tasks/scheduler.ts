import cron, { type ScheduledTask as CronJob } from "node-cron";
import { listScheduledTasks } from "./store";
import { executeScheduledTask } from "./executor";

const jobs = new Map<string, CronJob>();
let started = false;

export function isSchedulerStarted(): boolean {
  return started;
}

export function reloadTaskScheduler(): { registered: number; invalid: string[] } {
  for (const job of jobs.values()) job.stop();
  jobs.clear();

  const invalid: string[] = [];
  let registered = 0;

  for (const task of listScheduledTasks()) {
    if (!task.enabled) continue;
    if (!cron.validate(task.cron)) {
      invalid.push(`${task.name} (${task.cron})`);
      continue;
    }
    const job = cron.schedule(
      task.cron,
      () => {
        void executeScheduledTask(task.id, "cron");
      },
      { timezone: task.timezone || "Asia/Shanghai" },
    );
    jobs.set(task.id, job);
    registered++;
  }

  started = true;
  return { registered, invalid };
}

export function startTaskScheduler(): {
  registered: number;
  invalid: string[];
  disabled?: boolean;
} {
  if (process.env.DISABLE_TASK_SCHEDULER === "1") {
    return { registered: 0, invalid: [], disabled: true };
  }
  return reloadTaskScheduler();
}
