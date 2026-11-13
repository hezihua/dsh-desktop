import { generateText, stepCountIs } from "ai";
import { isHarnessConfigured } from "@/lib/dsh/config";
import { runOpsHarnessAgent } from "@/lib/dsh/ops-agent";
import {
  isLlmConfigured,
  resolveMonitorLanguageModel,
} from "@/lib/llm-model";
import type { AgentCapabilities } from "@/lib/agent-policy";
import { getEffectiveCapabilitiesForTarget } from "@/lib/server-policy-store";
import { getSshHost } from "@/lib/ssh/store";
import { assertSshHostAllowed } from "@/lib/ssh/exec";
import {
  buildMonitorTools,
  executeMonitorTool,
  type MonitorContext,
  type MonitorToolName,
} from "./tools";
import { listMonitorCapabilities } from "./access";
import {
  formatSkillsForSystemPrompt,
  listSkillSummaries,
  matchSkills,
} from "@/lib/skills";

export type MonitorChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type MonitorAgentOptions = {
  targetHostId?: string | null;
  caps?: AgentCapabilities;
  harnessSessionId?: string | null;
};

function buildContext(opts: MonitorAgentOptions): MonitorContext {
  const hostId = opts.targetHostId ?? null;
  const scope = hostId ?? "local";
  return {
    caps: opts.caps ?? getEffectiveCapabilitiesForTarget(scope),
    hostId,
  };
}

function targetLabel(ctx: MonitorContext): string {
  if (!ctx.hostId) return "本机";
  const h = getSshHost(ctx.hostId);
  return h ? `远程 · ${h.name}` : `远程 · ${ctx.hostId}`;
}

const SYSTEM = `你是 Infini 运维 Agent。职责：
- 只读查看服务器：硬件/负载、磁盘、进程、系统日志、配置文件（本机或通过 SSH 的远程主机）
- 绝不建议 sudo、写文件、重启服务；仅汇报与诊断
- SSH 远程需用户在「主机」页登记，并在「权限」中为该主机单独授权
回答使用简体中文，结构清晰，必要时用 markdown 代码块展示原始输出。`;

function extractPath(text: string): string | null {
  const m = text.match(/(?:\/[\w./_-]+|\.\/[\w./_-]+|[\w.-]+\.(?:log|conf|yaml|yml|json|ts|js))/);
  return m?.[0] ?? null;
}

function hasAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
}

function sshGate(ctx: MonitorContext): string | null {
  if (!ctx.hostId) return null;
  const gate = assertSshHostAllowed(ctx.hostId, ctx.caps);
  return gate.ok ? null : gate.reason;
}

export async function runLocalMonitorAgent(
  userText: string,
  opts: MonitorAgentOptions = {},
): Promise<{
  reply: string;
  mode: "local";
  toolsUsed: string[];
  target: string;
}> {
  const ctx = buildContext(opts);
  const blocked = sshGate(ctx);
  if (blocked) {
    return { mode: "local", toolsUsed: [], target: targetLabel(ctx), reply: blocked };
  }

  const toolsUsed: string[] = [];
  const text = userText.trim();

  const run = async (name: MonitorToolName, args: Record<string, unknown> = {}) => {
    toolsUsed.push(name);
    return executeMonitorTool(name, args, ctx);
  };

  if (hasAny(text, ["帮助", "你能", "可以做什么", "help", "能力", "skill"])) {
    const cap = listMonitorCapabilities();
    const skillList = listSkillSummaries();
    return {
      mode: "local",
      target: targetLabel(ctx),
      toolsUsed: ["capabilities"],
      reply: [
        `目标：${targetLabel(ctx)}`,
        "",
        "我可以只读监控服务器，例如：",
        "",
        "- 硬件/状态：「看下 CPU 和内存」「磁盘满了没」",
        "- 日志：「tail /var/log/syslog」「最近 systemd 日志」",
        "- 配置：「读 /etc/nginx/nginx.conf」",
        "- 远程：在监控页选择 SSH 主机，或在「主机」页添加服务器",
        "",
        "路径白名单：",
        ...cap.logs.map((l) => `  - 日志 ${l}`),
        ...cap.configs.map((c) => `  - 配置 ${c}`),
        "",
        cap.notes.map((n) => `- ${n}`).join("\n"),
        "",
        skillList.length
          ? `已加载 ${skillList.length} 个 Agent Skill（「Skills」页管理）：\n${skillList.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`
          : "可在「Skills」页添加 SKILL.md 扩展排查流程。",
      ].join("\n"),
    };
  }

  if (hasAny(text, ["journal", "systemd", "journalctl"])) {
    const body = await run("journal_tail", { lines: 80 });
    return {
      mode: "local",
      target: targetLabel(ctx),
      toolsUsed,
      reply: `## systemd 日志 (${targetLabel(ctx)})\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }

  const path = extractPath(text);
  if (path && hasAny(text, ["配置", "config", "nginx", "conf", "读取", "查看", "打开"])) {
    try {
      const body = await run("read_config", { path });
      return {
        mode: "local",
        target: targetLabel(ctx),
        toolsUsed,
        reply: `## ${path}\n\n\`\`\`\n${body}\n\`\`\``,
      };
    } catch (e) {
      return {
        mode: "local",
        target: targetLabel(ctx),
        toolsUsed,
        reply: `无法读取配置: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (hasAny(text, ["日志", "log", "tail", "syslog", "auth"])) {
    if (!ctx.hostId && hasAny(text, ["列出", "列表", "list"]) && hasAny(text, ["/var/log", "var/log"])) {
      const body = await run("list_var_log");
      return {
        mode: "local",
        target: targetLabel(ctx),
        toolsUsed,
        reply: `## /var/log 文件\n\n\`\`\`\n${body}\n\`\`\``,
      };
    }
    const target = path ?? "/var/log/syslog";
    try {
      const body = await run("tail_system_log", { path: target, lines: 60 });
      return {
        mode: "local",
        target: targetLabel(ctx),
        toolsUsed,
        reply: `## 日志尾部 ${target}\n\n\`\`\`\n${body}\n\`\`\``,
      };
    } catch (e) {
      return {
        mode: "local",
        target: targetLabel(ctx),
        toolsUsed,
        reply: `无法读取日志: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (hasAny(text, ["进程", "process", "ps ", "占用"])) {
    const body = await run("process_top", { limit: 20 });
    return {
      mode: "local",
      target: targetLabel(ctx),
      toolsUsed,
      reply: `## 进程 (Top 内存)\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }

  if (!ctx.hostId && hasAny(text, ["端口", "网络", "监听", "network", "listen", "ss "])) {
    const body = await run("network_listeners");
    return {
      mode: "local",
      target: targetLabel(ctx),
      toolsUsed,
      reply: `## 监听端口\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }

  if (hasAny(text, ["磁盘", "disk", "df", "空间", "硬盘"])) {
    const body = await run("disk_usage");
    return {
      mode: "local",
      target: targetLabel(ctx),
      toolsUsed,
      reply: `## 磁盘 (${targetLabel(ctx)})\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }

  if (
    hasAny(text, [
      "硬件",
      "cpu",
      "内存",
      "memory",
      "负载",
      "load",
      "概览",
      "状态",
      "服务器",
      "监控",
    ])
  ) {
    const body = await run("host_overview");
    return { mode: "local", target: targetLabel(ctx), toolsUsed, reply: body };
  }

  const overview = await run("host_overview");
  return {
    mode: "local",
    target: targetLabel(ctx),
    toolsUsed,
    reply: [
      overview,
      "",
      "---",
      "",
      "未完全理解你的问题。你可以试试：",
      "- 「列出 /var/log」（本机）",
      "- 「tail /var/log/syslog」",
      "- 「最近 systemd 日志」",
      "",
      "配置 `OPENROUTER_API_KEY` 或 `AI_GATEWAY_API_KEY` 后可使用 LLM 自由对话。",
    ].join("\n"),
  };
}

export async function runMonitorAgent(
  messages: MonitorChatMessage[],
  opts: MonitorAgentOptions = {},
): Promise<{
  reply: string;
  mode: "local" | "llm" | "harness";
  toolsUsed: string[];
  target: string;
  harnessSessionId?: string;
}> {
  const ctx = buildContext(opts);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content.trim()) {
    return {
      reply: "请输入要监控或排查的内容。",
      mode: "local",
      toolsUsed: [],
      target: targetLabel(ctx),
    };
  }

  const blocked = sshGate(ctx);
  if (blocked) {
    return { reply: blocked, mode: "local", toolsUsed: [], target: targetLabel(ctx) };
  }

  if (isHarnessConfigured()) {
    try {
      const h = await runOpsHarnessAgent({
        messages,
        targetHostId: opts.targetHostId,
        targetLabel: targetLabel(ctx),
        sessionId: opts.harnessSessionId ?? undefined,
      });
      return {
        reply: h.reply,
        mode: "harness",
        toolsUsed: [],
        target: targetLabel(ctx),
        harnessSessionId: h.harnessSessionId,
      };
    } catch (e) {
      const fallback = await runLocalMonitorAgent(lastUser.content, opts);
      return {
        ...fallback,
        reply: `${fallback.reply}\n\n---\n\n_Harness 调用失败，已改用本地规则：${e instanceof Error ? e.message : String(e)}_`,
      };
    }
  }

  if (!isLlmConfigured()) {
    return runLocalMonitorAgent(lastUser.content, opts);
  }

  const model = resolveMonitorLanguageModel();
  const tools = buildMonitorTools(ctx);
  const toolsUsed: string[] = [];
  const matchedSkills = matchSkills(lastUser.content, 3);
  const skillBlock = formatSkillsForSystemPrompt(matchedSkills);
  if (matchedSkills.length) {
    toolsUsed.push(`skills:${matchedSkills.map((s) => s.name).join(",")}`);
  }

  try {
    const result = await generateText({
      model,
      system: `${SYSTEM}\n\n当前目标：${targetLabel(ctx)}${skillBlock}`,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools,
      stopWhen: stepCountIs(6),
      onStepFinish: ({ toolCalls }) => {
        for (const tc of toolCalls) {
          toolsUsed.push(tc.toolName);
        }
      },
    });

    return {
      reply: result.text || "（模型未返回文本）",
      mode: "llm",
      toolsUsed: [...new Set(toolsUsed)],
      target: targetLabel(ctx),
    };
  } catch (e) {
    const fallback = await runLocalMonitorAgent(lastUser.content, opts);
    return {
      ...fallback,
      reply: `${fallback.reply}\n\n---\n\n_LLM 调用失败，已改用本地规则引擎：${e instanceof Error ? e.message : String(e)}_`,
    };
  }
}
