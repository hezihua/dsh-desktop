"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAppI18n } from "@/lib/app-i18n";

type TaskKind =
  | "analyze_fleet"
  | "analyze_local"
  | "analyze_host"
  | "command_local"
  | "command_ssh";

type Task = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  kind: TaskKind;
  targetHostId?: string;
  command?: string;
  unattended: boolean;
  lastRunAt?: string;
  lastStatus?: string;
  lastMessage?: string;
};

/** 表单：全部 | 本机 | SSH 主机 id */
type TaskTarget = "__fleet__" | "local" | string;
type TaskAction = "analyze" | "command";

type RunLog = {
  id: string;
  taskName: string;
  trigger: string;
  startedAt: string;
  status: string;
  message: string;
};

type Host = { id: string; name: string };

function resolveKind(action: TaskAction, target: TaskTarget): TaskKind {
  if (action === "analyze") {
    if (target === "__fleet__") return "analyze_fleet";
    if (target === "local") return "analyze_local";
    return "analyze_host";
  }
  if (target === "local") return "command_local";
  return "command_ssh";
}

export function ScheduledTasksView() {
  const { t } = useAppI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<RunLog[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const cronPresets = useMemo(
    () => [
      { label: t("fixbug.automation.cronPresets.daily8"), cron: "0 8 * * *" },
      { label: t("fixbug.automation.cronPresets.every6h"), cron: "0 */6 * * *" },
      { label: t("fixbug.automation.cronPresets.hourly"), cron: "0 * * * *" },
      { label: t("fixbug.automation.cronPresets.weeklyMon"), cron: "0 9 * * 1" },
    ],
    [t],
  );
  const taskTargetLabel = useCallback(
    (task: Task): string => {
      if (task.kind === "analyze_fleet") return t("fixbug.common.fleet");
      if (task.kind === "analyze_local" || task.kind === "command_local") {
        return t("fixbug.common.local");
      }
      const h = hosts.find((x) => x.id === task.targetHostId);
      return h?.name ?? task.targetHostId ?? t("fixbug.common.sshHost");
    },
    [hosts, t],
  );
  const taskActionLabel = useCallback(
    (task: Task): string => {
      if (task.kind.startsWith("analyze")) return t("fixbug.common.analyzeReport");
      return `${t("fixbug.common.runCommand")}${task.command ? ` · ${task.command}` : ""}`;
    },
    [t],
  );
  const [scheduler, setScheduler] = useState<{ registered: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    cron: "0 8 * * *",
    timezone: "Asia/Shanghai",
    target: "__fleet__" as TaskTarget,
    command: "",
    unattended: false,
    enabled: true,
  });

  useEffect(() => {
    setForm((f) => ({
      ...f,
      name: t("fixbug.automation.defaultTaskName"),
      description: t("fixbug.automation.defaultTaskDesc"),
    }));
  }, [t]);

  const runCommand = form.command.trim().length > 0;
  const commandNeedsHost = runCommand && form.target === "__fleet__";

  const load = useCallback(async () => {
    const [tasksRes, hostsRes] = await Promise.all([
      fetch("/api/server/tasks"),
      fetch("/api/server/ssh"),
    ]);
    const data = await tasksRes.json();
    const hostsData = await hostsRes.json();
    setTasks(data.tasks ?? []);
    setRuns(data.runs ?? []);
    setScheduler(data.scheduler ?? null);
    setHosts(hostsData.hosts ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (commandNeedsHost) {
      setMsg(t("fixbug.automation.pickHostError"));
      return;
    }
    setMsg(null);
    const action: TaskAction = runCommand ? "command" : "analyze";
    const kind = resolveKind(action, form.target);
    const targetHostId =
      form.target !== "__fleet__" && form.target !== "local" ? form.target : undefined;
    const body = {
      name: form.name,
      description: form.description.trim() || undefined,
      cron: form.cron,
      timezone: form.timezone,
      enabled: form.enabled,
      kind,
      targetHostId,
      command: runCommand ? form.command.trim() : undefined,
      unattended: form.unattended,
    };
    const res = await fetch("/api/server/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? t("fixbug.automation.createFailed"));
      return;
    }
    setMsg(
      t("fixbug.automation.created", { count: String(data.scheduler?.registered ?? 0) }),
    );
    await load();
  }

  async function toggleEnabled(task: Task) {
    await fetch(`/api/server/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !task.enabled }),
    });
    await load();
  }

  async function runNow(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/server/tasks/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message ?? t("fixbug.automation.runFailed"));
      setMsg(data.message);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(id: string) {
    await fetch(`/api/server/tasks/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-100">
          {t("fixbug.automation.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          {t("fixbug.automation.lede")}
        </p>
        {scheduler != null && (
          <p className="mt-1 text-xs text-slate-500">
            {t("fixbug.automation.registered", { count: String(scheduler.registered) })}
          </p>
        )}
      </section>

      <form
        onSubmit={onCreate}
        className="grid max-w-2xl gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4"
      >
        <div className="text-sm text-slate-200">{t("fixbug.automation.newTask")}</div>
        <label className="block text-xs text-slate-500">
          {t("fixbug.automation.taskName")}
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t("fixbug.automation.taskNamePh")}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {cronPresets.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => setForm((f) => ({ ...f, cron: p.cron }))}
              className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400 hover:border-teal-400/30"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            required
            value={form.cron}
            onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
            placeholder={t("fixbug.automation.cronPh")}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
          />
          <input
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            className="w-40 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            title={t("fixbug.automation.timezone")}
          />
        </div>
        <label className="block text-xs text-slate-500">
          {t("fixbug.automation.description")}
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t("fixbug.automation.descriptionPh")}
            rows={2}
            className="mt-1 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <label className="block text-xs text-slate-500">
          {t("fixbug.automation.targetHost")}
          <select
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value as TaskTarget }))}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
          >
            {!runCommand && (
              <option value="__fleet__">{t("fixbug.automation.fleetOption")}</option>
            )}
            <option value="local">{t("fixbug.common.local")}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          {t("fixbug.automation.commandOptional")}
          <input
            value={form.command}
            onChange={(e) => {
              const command = e.target.value;
              setForm((f) => ({
                ...f,
                command,
                target:
                  command.trim() && f.target === "__fleet__" ? "local" : f.target,
              }));
            }}
            placeholder={t("fixbug.automation.commandPh")}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-slate-100"
          />
        </label>
        {runCommand && form.target === "local" && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={form.unattended}
              onChange={(e) => setForm((f) => ({ ...f, unattended: e.target.checked }))}
            />
            {t("fixbug.automation.unattended")}
          </label>
        )}
        {commandNeedsHost && (
          <p className="text-xs text-amber-300">{t("fixbug.automation.pickHostForCmd")}</p>
        )}
        <button
          type="submit"
          className="rounded-md bg-teal-500/90 py-2 text-sm font-medium text-slate-950 hover:bg-teal-400"
        >
          {t("fixbug.automation.createCron")}
        </button>
      </form>

      {msg && <p className="text-sm text-teal-300">{msg}</p>}

      <section>
        <h2 className="mb-3 text-sm text-slate-300">{t("fixbug.automation.taskList")}</h2>
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-slate-100">
                    {task.name}
                    <span
                      className={`text-[10px] uppercase ${task.enabled ? "text-teal-400" : "text-slate-600"}`}
                    >
                      {task.enabled ? t("fixbug.common.enabled") : t("fixbug.common.disabled")}
                    </span>
                  </div>
                  {task.description && (
                    <p className="mt-1 text-xs text-slate-500">{task.description}</p>
                  )}
                  <div className="mt-1 font-mono text-xs text-slate-600">
                    {task.cron} ({task.timezone}) · {taskTargetLabel(task)} · {taskActionLabel(task)}
                  </div>
                  {task.lastRunAt && (
                    <div className="mt-1 text-xs text-slate-600">
                      {t("fixbug.automation.lastRun")} {task.lastRunAt} · {task.lastStatus} —{" "}
                      {(task.lastMessage ?? "").slice(0, 120)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === task.id}
                    onClick={() => runNow(task.id)}
                    className="rounded-md border border-white/15 px-3 py-1 text-xs text-slate-300"
                  >
                    {busy === task.id ? t("fixbug.common.running") : t("fixbug.common.run")}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(task)}
                    className="rounded-md border border-white/15 px-3 py-1 text-xs text-slate-300"
                  >
                    {task.enabled ? t("fixbug.automation.disable") : t("fixbug.automation.enable")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(task.id)}
                    className="rounded-md border border-rose-400/30 px-3 py-1 text-xs text-rose-300"
                  >
                    {t("fixbug.common.delete")}
                  </button>
                </div>
              </div>
            </li>
          ))}
          {tasks.length === 0 && (
            <p className="text-sm text-slate-600">{t("fixbug.automation.noTasks")}</p>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm text-slate-300">{t("fixbug.automation.recentRuns")}</h2>
        <ul className="max-h-64 space-y-1 overflow-y-auto text-xs text-slate-500">
          {runs.map((r) => (
            <li key={r.id} className="border-b border-white/5 py-1.5 font-mono">
              [{r.startedAt}] {r.trigger} · {r.taskName} · {r.status} —{" "}
              {r.message.slice(0, 160)}
            </li>
          ))}
          {runs.length === 0 && <li>{t("fixbug.common.noRecords")}</li>}
        </ul>
      </section>
    </div>
  );
}
