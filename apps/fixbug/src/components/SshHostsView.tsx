"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAppI18n } from "@/lib/app-i18n";

type Host = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  source: "config" | "manual";
};

export function SshHostsView() {
  const { t } = useAppI18n();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [configContent, setConfigContent] = useState("");
  const [configExists, setConfigExists] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "22",
    username: "",
    privateKeyPath: "~/.ssh/id_rsa",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const load = useCallback(async () => {
    const [listRes, cfgRes] = await Promise.all([
      fetch("/api/server/ssh?sync=1"),
      fetch("/api/server/ssh/config"),
    ]);
    const listData = await listRes.json();
    const cfgData = await cfgRes.json();
    setHosts(listData.hosts ?? []);
    setConfigPath(listData.config?.editablePath ?? cfgData.path ?? "");
    setConfigExists(Boolean(listData.config?.exists ?? cfgData.exists));
    setConfigContent(cfgData.content ?? "");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSaveConfig() {
    setSavingConfig(true);
    setMsg(null);
    try {
      const res = await fetch("/api/server/ssh?action=config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: configContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("fixbug.hosts.saveConfigFailed"));
      setMsg(
        t("fixbug.hosts.wroteConfig", {
          path: String(data.path),
          count: String(data.hostCount),
        }),
      );
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingConfig(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/server/ssh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        privateKeyPath: form.privateKeyPath,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? t("fixbug.hosts.saveFailed"));
      return;
    }
    setMsg(t("fixbug.hosts.savedManual", { name: data.host.name }));
    setForm({ name: "", host: "", port: "22", username: "", privateKeyPath: form.privateKeyPath });
    await load();
  }

  function setMessage(s: string) {
    setMsg(s);
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/server/ssh?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? t("fixbug.hosts.deleteFailed"));
      return;
    }
    await load();
  }

  async function onTest(id: string) {
    setTesting(id);
    setMsg(null);
    try {
      const res = await fetch("/api/server/ssh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? t("fixbug.hosts.testFailed"));
      setMsg(t("fixbug.hosts.testOk", { output: String(data.output) }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-100">
          {t("fixbug.hosts.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{t("fixbug.hosts.lede")}</p>
      </section>

      <section className="space-y-3 rounded-xl border border-teal-400/20 bg-teal-400/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-teal-100">{t("fixbug.hosts.configTitle")}</h2>
          <span className="font-mono text-xs text-slate-500">{configPath}</span>
        </div>
        <p className="text-xs text-slate-500">{t("fixbug.hosts.configHelp")}</p>
        <textarea
          value={configContent}
          onChange={(e) => setConfigContent(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-lg border border-white/10 bg-black/40 p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-slate-200"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={savingConfig}
            onClick={onSaveConfig}
            className="rounded-md bg-teal-500/90 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-50"
          >
            {savingConfig ? t("fixbug.common.saving") : t("fixbug.hosts.saveConfig")}
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-md border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            {t("fixbug.hosts.reload")}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm text-slate-300">{t("fixbug.hosts.loadedTitle")}</h2>
        <ul className="space-y-2">
          {hosts.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm"
            >
              <div>
                <div className="flex items-center gap-2 text-slate-100">
                  {h.name}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                      h.source === "config"
                        ? "bg-teal-400/15 text-teal-300"
                        : "bg-white/10 text-slate-500"
                    }`}
                  >
                    {h.source === "config" ? t("fixbug.common.configSource") : t("fixbug.common.manual")}
                  </span>
                </div>
                <div className="font-mono text-xs text-slate-500">
                  {h.username}@{h.host}:{h.port} · {h.privateKeyPath}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={testing === h.id}
                  onClick={() => onTest(h.id)}
                  className="rounded-md border border-white/15 px-3 py-1 text-xs text-slate-300 hover:bg-white/5"
                >
                  {testing === h.id ? t("fixbug.hosts.testing") : t("fixbug.hosts.testConn")}
                </button>
                {h.source === "manual" && (
                  <button
                    type="button"
                    onClick={() => onDelete(h.id)}
                    className="rounded-md border border-rose-400/30 px-3 py-1 text-xs text-rose-300 hover:bg-rose-400/10"
                  >
                    {t("fixbug.common.delete")}
                  </button>
                )}
              </div>
            </li>
          ))}
          {hosts.length === 0 && (
            <p className="text-sm text-slate-600">
              {t("fixbug.hosts.empty")}
            </p>
          )}
        </ul>
      </section>

      <details className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <summary className="cursor-pointer text-sm text-slate-400">{t("fixbug.hosts.manualAdd")}</summary>
        <form onSubmit={onSubmit} className="mt-4 grid max-w-xl gap-3">
          <input
            required
            placeholder={t("fixbug.hosts.displayName")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              required
              placeholder="HostName / IP"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              placeholder={t("fixbug.hosts.port")}
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              className="w-20 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
          </div>
          <input
            required
            placeholder="User"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder={t("fixbug.hosts.identityPath")}
            value={form.privateKeyPath}
            onChange={(e) => setForm((f) => ({ ...f, privateKeyPath: e.target.value }))}
            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            className="rounded-md border border-white/15 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            {t("fixbug.hosts.saveManual")}
          </button>
        </form>
      </details>

      {msg && <p className="text-sm text-teal-300">{msg}</p>}
    </div>
  );
}
