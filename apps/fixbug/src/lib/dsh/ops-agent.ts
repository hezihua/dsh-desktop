import { getDshHarness } from "@/lib/dsh/client";
import type { MonitorChatMessage } from "@/lib/server-monitor/agent";

export async function runOpsHarnessAgent(options: {
  messages: MonitorChatMessage[];
  targetHostId?: string | null;
  targetLabel: string;
  sessionId?: string;
}): Promise<{ reply: string; harnessSessionId?: string }> {
  const harness = await getDshHarness();
  const targetLine = options.targetHostId
    ? `[targetHostId=${options.targetHostId}] 远程：${options.targetLabel}`
    : `[target=local] 本机：${options.targetLabel}`;

  const transcript = options.messages
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
    .join("\n\n");

  const prompt = `${targetLine}\n\n${transcript}\n\n助手:`;

  const result = await harness.run(prompt, {
    sessionId: options.sessionId,
  });

  return {
    reply: result.finalResponse?.trim() || "（Harness 未返回文本）",
    harnessSessionId: result.sessionId,
  };
}
