"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelDesktopHarnessChat,
  isDesktopHarnessShell,
  sendDesktopHarnessChat,
} from "@/lib/desktop-harness-chat";
import { useAppI18n } from "@/lib/app-i18n";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: { mode?: string; toolsUsed?: string[]; target?: string };
};

type SshHost = { id: string; name: string };

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function renderContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3).replace(/^\w+\n/, "");
      return (
        <pre
          key={i}
          className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-slate-300"
        >
          {inner.trimEnd()}
        </pre>
      );
    }
    return (
      <span key={i} className="whitespace-pre-wrap">
        {part}
      </span>
    );
  });
}

export function MonitorChatView() {
  const { t } = useAppI18n();
  const desktopShell = isDesktopHarnessShell();
  const suggestions = useMemo(
    () => [
      t("fixbug.monitor.suggestion0"),
      t("fixbug.monitor.suggestion1"),
      t("fixbug.monitor.suggestion2"),
      t("fixbug.monitor.suggestion3"),
      t("fixbug.monitor.suggestion4"),
      t("fixbug.monitor.suggestion5"),
    ],
    [t],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [harnessEnabled, setHarnessEnabled] = useState<boolean | null>(null);
  const [llmEnabled, setLlmEnabled] = useState<boolean | null>(null);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [harnessSessionId, setHarnessSessionId] = useState<string | null>(null);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [targetHostId, setTargetHostId] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelingRef = useRef(false);
  const inFlightRunIdRef = useRef(0);
  const localLabel = t("fixbug.common.local");
  const cancelAria = t("chat.cancelAria");
  const sendAria = t("chat.sendAria");
  const inputAria = t("chat.inputAria");

  useEffect(() => {
    if (!desktopShell) {
      fetch("/api/monitor/chat")
        .then((r) => r.json())
        .then((d) => {
          setHarnessEnabled(Boolean(d.harness));
          setLlmEnabled(Boolean(d.llm));
          setLlmModel(d.model ?? null);
        })
        .catch(() => setLlmEnabled(false));
    } else {
      setHarnessEnabled(false);
      setLlmEnabled(false);
    }
    fetch("/api/server/ssh")
      .then((r) => r.json())
      .then((d) => setHosts(d.hosts ?? []))
      .catch(() => setHosts([]));
  }, [desktopShell]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  const opsContext = useCallback(() => {
    const host = hosts.find((h) => h.id === targetHostId);
    return {
      targetHostId: targetHostId || undefined,
      targetLabel: host ? `SSH · ${host.name}` : undefined,
    };
  }, [hosts, targetHostId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
      };
      const runId = ++inFlightRunIdRef.current;
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      cancelingRef.current = false;
      setLoading(true);

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      try {
        if (desktopShell) {
          const payload = nextMessages.map(({ role, content }) => ({ role, content }));
          const result = await sendDesktopHarnessChat(payload, {
            sessionId: harnessSessionId ?? undefined,
            opsContext: opsContext(),
          });
          if (runId !== inFlightRunIdRef.current) return;
          if (result.sessionId) setHarnessSessionId(result.sessionId);
          setMessages((prev) => [
            ...prev,
            {
              id: newId(),
              role: "assistant",
              content: result.reply,
              meta: { mode: "harness-client", target: targetHostId || localLabel },
            },
          ]);
          return;
        }

        const payload = nextMessages.map(({ role, content }) => ({ role, content }));
        const res = await fetch("/api/monitor/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payload,
            targetHostId: targetHostId || null,
            harnessSessionId,
          }),
          signal,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? t("fixbug.common.requestFailed"));
        }
        if (runId !== inFlightRunIdRef.current) return;
        if (data.harnessSessionId) {
          setHarnessSessionId(data.harnessSessionId as string);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: data.reply as string,
            meta: {
              mode: data.mode,
              toolsUsed: data.toolsUsed,
              target: data.target,
            },
          },
        ]);
      } catch (e) {
        if (runId !== inFlightRunIdRef.current) return;
        const message = e instanceof Error ? e.message : String(e);
        const aborted = e instanceof DOMException && e.name === "AbortError";
        if (cancelingRef.current || aborted || message === "CHAT_CANCELED") return;
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: `${t("fixbug.common.errorPrefix")}${message}`,
          },
        ]);
      } finally {
        if (runId === inFlightRunIdRef.current) {
          cancelingRef.current = false;
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [desktopShell, harnessSessionId, loading, localLabel, messages, opsContext, t, targetHostId],
  );

  const cancelRun = useCallback(() => {
    if (!loading) return;
    cancelingRef.current = true;
    inFlightRunIdRef.current += 1;
    setLoading(false);
    abortRef.current?.abort();
    if (desktopShell) cancelDesktopHarnessChat();
  }, [desktopShell, loading]);

  const runtimeTag = desktopShell
    ? t("fixbug.monitor.runtimeDesktop")
    : harnessEnabled === null
      ? t("fixbug.monitor.runtimeDetecting")
      : harnessEnabled
        ? t("fixbug.monitor.runtimeHarness")
        : llmEnabled
          ? t("fixbug.monitor.runtimeLlm", { model: llmModel ?? t("fixbug.common.model") })
          : t("fixbug.monitor.runtimeRules");

  const runtimeWarn = !desktopShell && harnessEnabled !== true && !llmEnabled;

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[480px] flex-col">
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <label className="inline-flex items-center gap-2">
          <span>{t("fixbug.monitor.target")}</span>
          <select
            value={targetHostId}
            onChange={(e) => setTargetHostId(e.target.value)}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-slate-200"
          >
            <option value="">{localLabel}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                SSH · {h.name}
              </option>
            ))}
          </select>
        </label>
        {hosts.length === 0 ? (
          <span className="text-slate-600">{t("fixbug.monitor.remoteHint")}</span>
        ) : null}
        {!desktopShell ? (
          <span
            className={
              runtimeWarn ? "text-amber-400/90" : "font-mono text-[10px] uppercase text-teal-400/80"
            }
          >
            {runtimeTag}
          </span>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] shadow-lg shadow-black/20">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs leading-relaxed text-slate-600">
              {t("fixbug.monitor.welcome")}
            </p>
          ) : null}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[80%] ${
                  m.role === "user"
                    ? "bg-teal-500/20 text-teal-50"
                    : "border border-white/5 bg-slate-900/60 text-slate-200"
                }`}
              >
                {renderContent(m.content)}
                {m.meta?.toolsUsed?.length || m.meta?.target ? (
                  <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-slate-500">
                    {m.meta.target ?? localLabel}
                    {m.meta.toolsUsed?.length
                      ? ` · ${m.meta.mode ?? "local"} · ${m.meta.toolsUsed.join(", ")}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
          {loading ? (
            <p className="text-sm text-slate-500">{t("fixbug.monitor.collecting")}</p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-white/10 p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading}
                onClick={() => send(s)}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400 transition hover:border-teal-400/30 hover:text-teal-200 disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="monitor-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="composer-capsule">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("fixbug.monitor.placeholder")}
                rows={1}
                disabled={loading}
                className="composer-capsule__input"
                aria-label={inputAria}
              />
              <div className="composer-capsule__bar">
                {loading ? (
                  <button
                    type="button"
                    className="composer-capsule__send composer-capsule__send--stop"
                    onClick={cancelRun}
                    aria-label={cancelAria}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={
                      input.trim()
                        ? "composer-capsule__send composer-capsule__send--ready"
                        : "composer-capsule__send"
                    }
                    disabled={!input.trim()}
                    aria-label={sendAria}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 19V5M5 12l7-7 7 7"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
