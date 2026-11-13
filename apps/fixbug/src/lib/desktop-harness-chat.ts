export type HarnessChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type HarnessOpsContext = {
  targetHostId?: string;
  targetLabel?: string;
};

type InfiniDesktop = {
  sendChat: (payload: {
    messages: HarnessChatMessage[];
    sessionId?: string;
    opsContext?: HarnessOpsContext;
  }) => Promise<{ reply: string; sessionId?: string }>;
  cancelChat?: () => Promise<void>;
};

function desktop(): InfiniDesktop | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as unknown as { infiniDesktop?: InfiniDesktop })
    .infiniDesktop;
  if (api && typeof api.sendChat === "function") return api;
  return undefined;
}

/** 在 Infini Desktop 渲染壳内：直连本机 Harness（非 fixbug 服务端 DSH） */
export function isDesktopHarnessShell(): boolean {
  return Boolean(desktop());
}

export async function sendDesktopHarnessChat(
  messages: HarnessChatMessage[],
  options?: { sessionId?: string; opsContext?: HarnessOpsContext },
): Promise<{ reply: string; sessionId?: string }> {
  const api = desktop();
  if (!api) {
    throw new Error("请在 Infini Desktop 中使用运维对话（客户端 Harness）");
  }
  return api.sendChat({
    messages,
    sessionId: options?.sessionId,
    opsContext: options?.opsContext,
  });
}

export function cancelDesktopHarnessChat(): void {
  const api = desktop();
  if (api?.cancelChat) void api.cancelChat();
}
