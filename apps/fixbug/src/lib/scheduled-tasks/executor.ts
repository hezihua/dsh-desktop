import { checkAction } from "@/lib/agent-policy";
import {
  analyzeAllServers,
  analyzeCurrentServer,
  analyzeTarget,
  createErrorReport,
} from "@/lib/server-analyze";
import { getSshHost } from "@/lib/ssh/store";
import { appendServerReport } from "@/lib/server-report-store";
import { executeServerAutomationWithApproval } from "@/lib/server-automation";
import {
  getEffectiveCapabilitiesForTarget,
  isTargetEnabled,
} from "@/lib/server-policy-store";
import { sshExecRemoteById } from "@/lib/ssh/exec";
import { completeOfficialModel, getMonitorModelId, isLlmConfigured } from "@/lib/llm-model";
import {
  appendTaskRun,
  getScheduledTask,
  patchTaskLastRun,
} from "./store";
import type { ScheduledTask } from "./types";

export type TaskTrigger = "cron" | "manual";

export async function executeScheduledTask(
  taskId: string,
  trigger: TaskTrigger,
): Promise<{ ok: boolean; message: string }> {
  const task = getScheduledTask(taskId);
  if (!task) {
    return { ok: false, message: "任务不存在" };
  }
  if (!task.enabled && trigger === "cron") {
    patchTaskLastRun(taskId, "skipped", "任务已禁用");
    return { ok: false, message: "任务已禁用" };
  }

  const startedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  try {
    const result = await runTaskBody(task);
    patchTaskLastRun(taskId, "ok", result.message);
    appendTaskRun({
      taskId: task.id,
      taskName: task.name,
      trigger,
      startedAt,
      status: "ok",
      message: result.message,
    });
    return { ok: true, message: result.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    patchTaskLastRun(taskId, "error", message);
    appendTaskRun({
      taskId: task.id,
      taskName: task.name,
      trigger,
      startedAt,
      status: "error",
      message,
    });
    return { ok: false, message };
  }
}

async function explainCommandResult(command: string, output: string): Promise<string> {
  if (!isLlmConfigured()) return output;
  const text = await completeOfficialModel(
    "你是运维助手，使用官方设置里已配置的模型。根据只读命令的输出，用简体中文用两三句话说明结果。不要建议执行写入、删除或重启。",
    `命令：${command}\n\n输出：\n${output.slice(0, 8000)}`,
  );
  if (!text) return output;
  return `${text}\n\n---\n官方模型 ${getMonitorModelId()}\n\n${output.slice(0, 2000)}`;
}

async function runTaskBody(task: ScheduledTask): Promise<{ message: string }> {
  switch (task.kind) {
    case "analyze_fleet": {
      const fleet = await analyzeAllServers();
      for (const r of fleet.reports) {
        appendServerReport(r);
      }
      return {
        message: `批次 ${fleet.batchId}：${fleet.ok} 台成功，${fleet.failed} 台失败（均已写入分析报告）`,
      };
    }
    case "analyze_local": {
      if (!isTargetEnabled("local")) throw new Error("本机未在「权限」中授权");
      const caps = getEffectiveCapabilitiesForTarget("local");
      const gate = checkAction("analyze", caps);
      if (!gate.allowed) throw new Error(gate.reason);
      const report = await analyzeCurrentServer();
      const stored = appendServerReport(report);
      return {
        message: `已生成分析报告 ${stored.id}：${stored.summary}`,
      };
    }
    case "analyze_host": {
      if (!task.targetHostId) throw new Error("未配置 targetHostId");
      const h = getSshHost(task.targetHostId);
      const target = {
        type: "ssh" as const,
        hostId: task.targetHostId,
        label: h?.name ?? task.targetHostId,
      };
      try {
        const report = await analyzeTarget(target);
        const stored = appendServerReport(report);
        return {
          message: `已生成 ${target.label} 分析报告 ${stored.id}：${stored.summary}`,
        };
      } catch (e) {
        const errReport = createErrorReport(target, e);
        const stored = appendServerReport(errReport);
        return {
          message: `分析失败，已写入失败报告 ${stored.id}：${stored.summary}`,
        };
      }
    }
    case "command_local": {
      if (!isTargetEnabled("local")) throw new Error("本机未在「权限」中授权");
      const caps = getEffectiveCapabilitiesForTarget("local");
      if (!task.command?.trim()) throw new Error("未配置 command");
      if (!caps.canRunCommands && !task.unattended) {
        throw new Error("策略未开启 canRunCommands");
      }
      const approved = task.unattended || !caps.requireHumanApproval;
      const effectiveCaps =
        task.unattended && !caps.canRunCommands
          ? { ...caps, canRunCommands: true }
          : caps;
      const res = executeServerAutomationWithApproval(task.command, effectiveCaps, {
        dryRun: false,
        approved,
      });
      if (!res.ok) throw new Error(res.reason ?? res.output ?? "命令失败");
      return { message: await explainCommandResult(task.command, res.output ?? "命令执行完成") };
    }
    case "command_ssh": {
      if (!task.targetHostId) throw new Error("未配置 targetHostId");
      if (!task.command?.trim()) throw new Error("未配置 command");
      if (!isTargetEnabled(task.targetHostId)) {
        throw new Error("该主机未在「权限」中单独授权");
      }
      const caps = getEffectiveCapabilitiesForTarget(task.targetHostId);
      if (!caps.canUseSsh) throw new Error("该主机未授权远程命令");
      const res = sshExecRemoteById(task.targetHostId, task.command, caps);
      if (!res.ok) throw new Error(res.error ?? res.stdout ?? "SSH 失败");
      return { message: await explainCommandResult(task.command!, res.stdout || "SSH 命令完成") };
    }
    default:
      throw new Error("未知任务类型");
  }
}
