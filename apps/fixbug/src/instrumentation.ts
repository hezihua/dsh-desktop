export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDefaultScheduledTasks } = await import(
      "@/lib/scheduled-tasks/store"
    );
    const { startTaskScheduler } = await import("@/lib/scheduled-tasks/scheduler");
    const created = ensureDefaultScheduledTasks();
    if (created) {
      console.info(`[Infini 运维 Agent] 已创建默认定时任务: ${created.name}`);
    }
    const result = startTaskScheduler();
    if (result.registered > 0) {
      console.info(
        `[Infini 运维 Agent] 已注册 ${result.registered} 个定时任务` +
          (result.invalid.length ? `；无效 cron: ${result.invalid.join(", ")}` : ""),
      );
    }
  }
}
