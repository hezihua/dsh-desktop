import { spawnSync } from "node:child_process";
import { checkAction, type AgentCapabilities } from "@/lib/agent-policy";

export type AutomationResult = {
  ok: boolean;
  dryRun: boolean;
  command: string;
  output?: string;
  reason?: string;
  requiresApproval?: boolean;
};

function runArgv(argv: string[]): { ok: boolean; output: string } {
  const res = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 512 * 1024,
  });
  if (res.error) {
    return { ok: false, output: res.error.message };
  }
  const combined = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  if (res.status !== 0) {
    return { ok: false, output: combined || `exit ${res.status}` };
  }
  return { ok: true, output: combined };
}

/** 将白名单命令拆为 argv（不支持 shell 管道） */
function commandToArgv(command: string): string[] | null {
  const trimmed = command.trim();
  if (!trimmed || /[|;`$()]/.test(trimmed)) return null;
  return trimmed.split(/\s+/);
}

export function executeServerAutomation(
  command: string,
  caps: AgentCapabilities,
  opts: { dryRun: boolean },
): AutomationResult {
  const decision = checkAction("run_command", caps, { command });
  if (!decision.allowed) {
    return {
      ok: false,
      dryRun: opts.dryRun,
      command,
      reason: decision.reason,
      requiresApproval: decision.requiresApproval,
    };
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      command,
      output: "策略允许执行；dry-run 未真正运行命令。关闭 dry-run 且保持人工审批流程后再执行。",
      requiresApproval: caps.requireHumanApproval,
    };
  }

  if (caps.requireHumanApproval) {
    return {
      ok: false,
      dryRun: false,
      command,
      reason: "策略要求人工审批：请确认后在 UI 勾选「我已审批」再执行",
      requiresApproval: true,
    };
  }

  const argv = commandToArgv(command);
  if (!argv) {
    return {
      ok: false,
      dryRun: false,
      command,
      reason: "命令含 shell 元字符或为空，拒绝执行",
    };
  }

  const ran = runArgv(argv);
  return {
    ok: ran.ok,
    dryRun: false,
    command,
    output: ran.output,
    reason: ran.ok ? undefined : "命令执行失败",
  };
}

/** 带显式审批的执行（UI 传 approved=true 时跳过 requireHumanApproval 拦截） */
export function executeServerAutomationWithApproval(
  command: string,
  caps: AgentCapabilities,
  opts: { dryRun: boolean; approved: boolean },
): AutomationResult {
  if (opts.dryRun) {
    const decision = checkAction("run_command", caps, { command });
    return {
      ok: decision.allowed,
      dryRun: true,
      command,
      output: decision.allowed
        ? "策略允许该命令；dry-run 未实际执行。"
        : undefined,
      reason: decision.allowed ? undefined : decision.reason,
      requiresApproval: caps.requireHumanApproval,
    };
  }

  const decision = checkAction("run_command", caps, { command });
  if (!decision.allowed) {
    return {
      ok: false,
      dryRun: false,
      command,
      reason: decision.reason,
    };
  }

  if (caps.requireHumanApproval && !opts.approved) {
    return {
      ok: false,
      dryRun: false,
      command,
      reason: "需要勾选人工审批确认",
      requiresApproval: true,
    };
  }

  const argv = commandToArgv(command);
  if (!argv) {
    return {
      ok: false,
      dryRun: false,
      command,
      reason: "命令含 shell 元字符或为空，拒绝执行",
    };
  }

  const ran = runArgv(argv);
  return {
    ok: ran.ok,
    dryRun: false,
    command,
    output: ran.output,
    reason: ran.ok ? undefined : "命令执行失败",
  };
}
