import type { StructuredAnalysisReport } from "@/lib/analysis-types";
import { createId } from "@/lib/id";
import {
  checkAction,
  type AgentCapabilities,
} from "@/lib/agent-policy";
import {
  getEffectiveCapabilitiesForTarget,
  isTargetEnabled,
} from "@/lib/server-policy-store";
import { assertSshHostAllowed, sshExecRemoteById } from "@/lib/ssh/exec";
import { getSshHost, listSshHostsPublic } from "@/lib/ssh/store";
import {
  formatBytes,
  getDiskUsageText,
  getHostOverview,
  getMemoryDetail,
  readJournalTail,
} from "@/lib/server-monitor/collect";
import { matchSkills } from "@/lib/skills";
import { completeOfficialModel, getMonitorModelId, isLlmConfigured } from "@/lib/llm-model";

export type ServerAutomationStep = {
  id: string;
  title: string;
  command?: string;
  risk: "low" | "medium" | "high" | "critical";
  automatable: boolean;
  requiredActions: Array<"analyze" | "run_command" | "apply_local_fix" | "read_repo">;
  description: string;
};

export type AnalysisTarget = {
  type: "local" | "ssh";
  hostId?: string;
  label: string;
};

export type ServerAnalysisReport = StructuredAnalysisReport & {
  status: "ok" | "error";
  batchId?: string;
  target: AnalysisTarget;
  errorMessage?: string;
  relatedSkills?: Array<{ name: string; description: string }>;
  host: {
    hostname: string;
    load1: number;
    memUsedRatio: number;
    diskAlert: boolean;
  };
  automations: ServerAutomationStep[];
};

type RawSignals = {
  hostname: string;
  load1: number;
  memUsedRatio: number;
  diskText: string;
  journal: string;
};

function parseDiskHighWatermark(dfText: string): string[] {
  const alerts: string[] = [];
  for (const line of dfText.split("\n").slice(1)) {
    const m = line.match(/(\d{1,3})%/);
    if (!m) continue;
    const pct = Number(m[1]);
    if (pct >= 90) alerts.push(line.trim());
  }
  return alerts;
}

function journalErrorHints(journal: string): string[] {
  return journal
    .split("\n")
    .filter((l) => /error|failed|fatal|denied/i.test(l))
    .slice(0, 8);
}

function parseMemRatioFromFree(freeText: string): number {
  const line = freeText.split("\n").find((l) => /^Mem:/i.test(l.trim()));
  if (!line) return 0;
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return 0;
  const total = parseFloat(parts[1]);
  const used = parseFloat(parts[2]);
  if (!total || Number.isNaN(used)) return 0;
  return Math.min(1, used / total);
}

function parseLoadFromUptime(uptimeText: string): number {
  const m = uptimeText.match(/load average[s]?:\s*([\d.]+)/i);
  return m ? Number(m[1]) : 0;
}

function buildReportFromSignals(
  signals: RawSignals,
  target: AnalysisTarget,
  opts?: { batchId?: string; status?: "ok" | "error"; errorMessage?: string },
): ServerAnalysisReport {
  const diskAlerts = parseDiskHighWatermark(signals.diskText);
  const journalErrors = journalErrorHints(signals.journal);
  const loadHigh = signals.load1 > 0 && signals.load1 > 4;

  const findings: StructuredAnalysisReport["findings"] = [];
  const hypotheses: string[] = [];
  const solutions: StructuredAnalysisReport["solutions"] = [];
  const automations: ServerAutomationStep[] = [];

  if (opts?.errorMessage) {
    findings.push({
      area: "error",
      detail: opts.errorMessage,
      confidence: 1,
    });
    hypotheses.push("采集或连接失败，以下为诊断信息，需人工复核");
  }

  if (signals.memUsedRatio > 0.9) {
    findings.push({
      area: "memory",
      detail: `内存使用率约 ${(signals.memUsedRatio * 100).toFixed(1)}%`,
      confidence: 0.85,
    });
    hypotheses.push("内存压力可能导致 OOM、服务重启或响应变慢");
    solutions.push({
      title: "排查内存占用最高的进程",
      steps: ["在监控对话中询问「进程占用」", "结合业务判断是否需要扩容或重启非核心服务"],
      risk: "low",
      automatable: true,
      requiredActions: ["analyze", "run_command"],
    });
    automations.push({
      id: "mem-ps",
      title: "导出 Top 内存进程",
      command: "ps aux --sort=-%mem",
      risk: "low",
      automatable: true,
      requiredActions: ["run_command"],
      description: "只读快照",
    });
  }

  if (diskAlerts.length) {
    findings.push({
      area: "disk",
      detail: `发现 ${diskAlerts.length} 个分区使用率 ≥ 90%`,
      confidence: 0.9,
    });
    hypotheses.push("磁盘满会导致日志无法写入、服务异常或数据库故障");
    solutions.push({
      title: "清理或扩容磁盘",
      steps: ["查看 /var/log 占用", "轮转或归档大日志", "长期：扩容或独立日志盘"],
      risk: "medium",
      automatable: true,
      requiredActions: ["run_command"],
    });
    automations.push({
      id: "disk-du-log",
      title: "统计 /var/log 目录占用",
      command: "du -sh /var/log",
      risk: "low",
      automatable: true,
      requiredActions: ["run_command"],
      description: "只读 du",
    });
  }

  if (loadHigh) {
    findings.push({
      area: "cpu",
      detail: `1 分钟负载 ${signals.load1.toFixed(2)}`,
      confidence: 0.75,
    });
    hypotheses.push("负载偏高可能来自 CPU 密集任务或突发流量");
  }

  if (journalErrors.length) {
    findings.push({
      area: "journal",
      detail: `近期日志含 ${journalErrors.length} 条 error/failed 相关行`,
      confidence: 0.7,
    });
    hypotheses.push("系统服务启动失败、权限或依赖异常");
  }

  if (!opts?.errorMessage && findings.length === 0) {
    findings.push({
      area: "health",
      detail: "未发现明显资源告警（规则引擎基线检查通过）",
      confidence: 0.6,
    });
    hypotheses.push("若仍有业务异常，请在监控对话中进一步排查");
  }

  automations.push({
    id: "df-h",
    title: "刷新磁盘使用",
    command: "df -h",
    risk: "low",
    automatable: true,
    requiredActions: ["run_command"],
    description: "只读 df",
  });

  const severity: StructuredAnalysisReport["severity"] = opts?.errorMessage
    ? "high"
    : diskAlerts.length || signals.memUsedRatio > 0.95
      ? "high"
      : loadHigh || signals.memUsedRatio > 0.85
        ? "medium"
        : "low";

  const status = opts?.status ?? (opts?.errorMessage ? "error" : "ok");

  const matchText = [
    opts?.errorMessage ?? "",
    findings.map((f) => f.detail).join(" "),
    diskAlerts.join(" "),
    journalErrors.join(" "),
  ].join("\n");
  const relatedSkills = matchSkills(matchText, 3).map((s) => ({
    name: s.name,
    description: s.description,
  }));

  return {
    summary: opts?.errorMessage
      ? `分析异常：${opts.errorMessage.slice(0, 120)}`
      : findings.length === 1 && findings[0].area === "health"
        ? "当前主机基线状态正常"
        : `检测到 ${findings.filter((f) => f.area !== "error").length || findings.length} 项需关注信号`,
    problemLocation: signals.hostname,
    category: opts?.errorMessage ? "server_health_error" : "server_health",
    severity,
    status,
    batchId: opts?.batchId,
    target,
    errorMessage: opts?.errorMessage,
    findings,
    rootCauseHypotheses: hypotheses,
    solutions,
    nextHumanDecision: [
      "在「监控」对话中追问具体日志或配置",
      "失败报告请检查 SSH、权限与网络",
      "在「自动化」查看 cron 是否按时触发",
      ...relatedSkills.map(
        (s) => `可参考 Skill「${s.name}」：${s.description}（Skills 页查看步骤）`,
      ),
    ],
    relatedSkills,
    evidence: {
      message: `load=${signals.load1.toFixed(2)} mem=${(signals.memUsedRatio * 100).toFixed(0)}%`,
      stackExcerpt:
        opts?.errorMessage ||
        journalErrors.join("\n") ||
        diskAlerts.join("\n") ||
        undefined,
    },
    host: {
      hostname: signals.hostname,
      load1: signals.load1,
      memUsedRatio: signals.memUsedRatio,
      diskAlert: diskAlerts.length > 0,
    },
    automations,
  };
}

function collectLocalSignals(): RawSignals {
  const overview = getHostOverview();
  const memDetail = getMemoryDetail();
  const diskText = getDiskUsageText();
  const journal = readJournalTail(120);
  const memUsedRatio =
    overview.memory.totalBytes > 0
      ? overview.memory.usedBytes / overview.memory.totalBytes
      : memDetail?.memTotal && memDetail.memAvailable != null
        ? 1 - memDetail.memAvailable / memDetail.memTotal
        : 0;

  return {
    hostname: overview.hostname,
    load1: overview.loadAverage["1m"],
    memUsedRatio,
    diskText,
    journal,
  };
}

function collectRemoteSignals(hostId: string, caps: AgentCapabilities): RawSignals {
  const meta = getSshHost(hostId);
  const label = meta?.name ?? hostId;

  const run = (cmd: string) => {
    const res = sshExecRemoteById(hostId, cmd, caps);
    if (!res.ok) throw new Error(res.error ?? `命令失败: ${cmd}`);
    return res.stdout;
  };

  const uname = run("uname -a");
  const uptime = run("uptime");
  const free = run("free -h");
  const diskText = run("df -h");
  let journal = "";
  try {
    journal = run("journalctl -n 80 --no-pager -o short-iso");
  } catch {
    try {
      journal = run("tail -n 80 /var/log/syslog");
    } catch {
      journal = "（无法读取 journal/syslog）";
    }
  }

  const hostname =
    uname.split(/\s+/)[1] ?? meta?.host ?? label;

  return {
    hostname,
    load1: parseLoadFromUptime(uptime),
    memUsedRatio: parseMemRatioFromFree(free),
    diskText,
    journal,
  };
}

export function createErrorReport(
  target: AnalysisTarget,
  error: unknown,
  batchId?: string,
): ServerAnalysisReport {
  const message = error instanceof Error ? error.message : String(error);
  return buildReportFromSignals(
    {
      hostname: target.label,
      load1: 0,
      memUsedRatio: 0,
      diskText: "",
      journal: "",
    },
    target,
    { batchId, status: "error", errorMessage: message },
  );
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断）`;
}

function parseModelReport(text: string): {
  summary?: string;
  severity?: ServerAnalysisReport["severity"];
  findings?: ServerAnalysisReport["findings"];
  rootCauseHypotheses?: string[];
  solutions?: Array<{ title?: string; steps?: string[]; risk?: string }>;
  nextHumanDecision?: string[];
} | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as {
      summary?: string;
      severity?: ServerAnalysisReport["severity"];
      findings?: ServerAnalysisReport["findings"];
      rootCauseHypotheses?: string[];
      solutions?: Array<{ title?: string; steps?: string[]; risk?: string }>;
      nextHumanDecision?: string[];
    };
  } catch {
    return null;
  }
}

async function applyOfficialModel(
  report: ServerAnalysisReport,
  signals: RawSignals,
): Promise<ServerAnalysisReport> {
  if (!isLlmConfigured() || report.status === "error") return report;
  const text = await completeOfficialModel(
    [
      "你是运维分析助手，使用官方设置里已配置的模型。",
      "根据采集到的只读数据给出简体中文分析。",
      "只输出一个 JSON 对象，不要写代码块之外的说明。",
      "字段：summary、severity（low|medium|high|critical）、findings（{area,detail,confidence}）、rootCauseHypotheses、solutions（{title,steps,risk}）、nextHumanDecision。",
      "不要建议 sudo、写文件、删数据或重启服务。",
    ].join("\n"),
    [
      `主机：${signals.hostname}`,
      `1 分钟负载：${signals.load1}`,
      `内存使用率：${(signals.memUsedRatio * 100).toFixed(1)}%`,
      "磁盘：",
      clip(signals.diskText, 4000),
      "近期日志：",
      clip(signals.journal, 6000),
    ].join("\n"),
  );
  if (!text) return report;
  const parsed = parseModelReport(text);
  if (!parsed?.summary?.trim()) return report;
  const severities = new Set(["low", "medium", "high", "critical"]);
  const risks = new Set(["low", "medium", "high", "critical"]);
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .filter((item) => item && typeof item.detail === "string" && item.detail.trim())
        .slice(0, 8)
        .map((item) => ({
          area: typeof item.area === "string" && item.area.trim() ? item.area.trim() : "health",
          detail: item.detail.trim(),
          confidence:
            typeof item.confidence === "number" ? Math.min(1, Math.max(0, item.confidence)) : 0.7,
        }))
    : report.findings;
  const solutions = Array.isArray(parsed.solutions)
    ? parsed.solutions
        .filter((item) => item && typeof item.title === "string" && item.title.trim())
        .slice(0, 6)
        .map((item) => ({
          title: item.title!.trim(),
          steps: Array.isArray(item.steps) ? item.steps.filter((step) => typeof step === "string").slice(0, 6) : [],
          risk: risks.has(item.risk ?? "") ? (item.risk as ServerAnalysisReport["solutions"][number]["risk"]) : "low",
          automatable: false,
          requiredActions: ["analyze" as const],
        }))
    : report.solutions;
  return {
    ...report,
    summary: parsed.summary.trim(),
    severity: severities.has(parsed.severity ?? "") ? parsed.severity! : report.severity,
    findings: findings.length ? findings : report.findings,
    rootCauseHypotheses: Array.isArray(parsed.rootCauseHypotheses)
      ? parsed.rootCauseHypotheses.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
      : report.rootCauseHypotheses,
    solutions: solutions.length ? solutions : report.solutions,
    nextHumanDecision: Array.isArray(parsed.nextHumanDecision)
      ? parsed.nextHumanDecision.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
      : report.nextHumanDecision,
    evidence: {
      ...report.evidence,
      source: `official-model:${getMonitorModelId()}`,
    },
  };
}

export async function analyzeTarget(target: AnalysisTarget, batchId?: string): Promise<ServerAnalysisReport> {
  if (target.type === "ssh" && !target.hostId) throw new Error("SSH 目标缺少 hostId");
  const scope: "local" | string =
    target.type === "local" ? "local" : (target.hostId as string);

  if (!isTargetEnabled(scope)) {
    throw new Error(
      target.type === "local"
        ? "本机未在「权限」中授权"
        : "该主机未在「权限」中单独授权",
    );
  }

  const caps = getEffectiveCapabilitiesForTarget(scope);
  const gate = checkAction("analyze", caps);
  if (!gate.allowed) throw new Error(gate.reason);

  if (target.type === "local") {
    const signals = collectLocalSignals();
    return applyOfficialModel(buildReportFromSignals(signals, target, { batchId, status: "ok" }), signals);
  }

  const sshGate = assertSshHostAllowed(target.hostId!, caps);
  if (!sshGate.ok) throw new Error(sshGate.reason);

  const signals = collectRemoteSignals(target.hostId!, sshGate.caps);
  return applyOfficialModel(buildReportFromSignals(signals, target, { batchId, status: "ok" }), signals);
}

export async function analyzeCurrentServer(): Promise<ServerAnalysisReport> {
  return analyzeTarget({ type: "local", label: "本机" });
}

export type FleetAnalysisResult = {
  batchId: string;
  reports: ServerAnalysisReport[];
  ok: number;
  failed: number;
};

/** 本机 + 所有已登记 SSH 主机；单机失败仍生成 error 报告 */
export async function analyzeAllServers(): Promise<FleetAnalysisResult> {
  const batchId = createId("bat");
  const reports: ServerAnalysisReport[] = [];

  const targets: AnalysisTarget[] = [
    { type: "local", label: "本机" },
    ...listSshHostsPublic().map((h) => ({
      type: "ssh" as const,
      hostId: h.id,
      label: h.name,
    })),
  ];

  for (const target of targets) {
    const scope = target.type === "local" ? "local" : target.hostId!;
    if (!isTargetEnabled(scope)) {
      reports.push(
        createErrorReport(
          target,
          new Error(
            target.type === "local"
              ? "本机未授权，已在「权限」中关闭"
              : "该主机未单独授权，请在「权限」中开启",
          ),
          batchId,
        ),
      );
      continue;
    }
    try {
      reports.push(await analyzeTarget(target, batchId));
    } catch (e) {
      reports.push(createErrorReport(target, e, batchId));
    }
  }

  const failed = reports.filter((r) => r.status === "error").length;
  return {
    batchId,
    reports,
    ok: reports.length - failed,
    failed,
  };
}

export function formatServerReportBrief(r: ServerAnalysisReport): string {
  return `${r.target.label} · ${r.summary}`;
}
