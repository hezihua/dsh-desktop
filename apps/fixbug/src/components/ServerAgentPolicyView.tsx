"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ServerPolicyDocument, TargetGrant } from "@/lib/server-target-policy";
import { useAppI18n } from "@/lib/app-i18n";

type SshHostRow = { id: string; name: string; grant: TargetGrant };

const CAP_I18N: Record<
  keyof Pick<
    TargetGrant,
    | "canAnalyze"
    | "canReadRepo"
    | "canProposePatch"
    | "canApplyLocalFix"
    | "canRunCommands"
    | "requireHumanApproval"
  >,
  string
> = {
  canAnalyze: "canAnalyze",
  canReadRepo: "canReadRepo",
  canProposePatch: "canProposePatch",
  canApplyLocalFix: "canMutateRepo",
  canRunCommands: "canExec",
  requireHumanApproval: "requireApproval",
};

const GRANT_KEYS = Object.keys(CAP_I18N) as Array<keyof typeof CAP_I18N>;

function defaultGrant(): TargetGrant {
  return {
    enabled: false,
    canAnalyze: true,
    canReadRepo: false,
    canProposePatch: false,
    canApplyLocalFix: false,
    canRunCommands: false,
    requireHumanApproval: true,
    maxAutoFixRisk: "none",
  };
}

export function ServerAgentPolicyView() {
  const { t } = useAppI18n();
  const grantToggles = useMemo(
    () =>
      GRANT_KEYS.map((key) => {
        const cap = CAP_I18N[key];
        return {
          key,
          label: t(`fixbug.policy.caps.${cap}.label`),
          hint: t(`fixbug.policy.caps.${cap}.hint`),
        };
      }),
    [t],
  );
  const [policy, setPolicy] = useState<ServerPolicyDocument | null>(null);
  const [sshHosts, setSshHosts] = useState<SshHostRow[]>([]);
  const [selected, setSelected] = useState<string>("local");
  const [examples, setExamples] = useState<Record<string, { allowed: boolean; reason: string }> | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    const res = await fetch("/api/server/policy");
    const data = await res.json();
    setPolicy(data.policy);
    setSshHosts(data.sshHosts ?? []);
    setExamples(data.examples);
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const currentGrant = useMemo((): TargetGrant => {
    if (!policy) return defaultGrant();
    if (selected === "local") return policy.local;
    return policy.hosts[selected] ?? defaultGrant();
  }, [policy, selected]);

  function patchGrant(patch: Partial<TargetGrant>) {
    if (!policy) return;
    const next = { ...currentGrant, ...patch };
    if (selected === "local") {
      setPolicy({ ...policy, local: next });
    } else {
      setPolicy({
        ...policy,
        hosts: { ...policy.hosts, [selected]: next },
      });
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!policy) return;
    setMessage(null);
    const res = await fetch("/api/server/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? t("fixbug.policy.saveFailed"));
      return;
    }
    setPolicy(data.policy);
    setMessage(data.message ?? t("fixbug.policy.saved"));
    await loadPolicy();
  }

  if (!policy) {
    return <p className="text-slate-500">{t("fixbug.policy.loadPolicy")}</p>;
  }

  const localLabel = t("fixbug.common.local");
  const auth = (on: boolean) => (on ? t("fixbug.common.authorized") : t("fixbug.common.unauthorized"));

  const targets: Array<{ id: string; label: string; enabled: boolean }> = [
    { id: "local", label: localLabel, enabled: policy.local.enabled },
    ...sshHosts.map((h) => ({
      id: h.id,
      label: h.name,
      enabled: (policy.hosts[h.id] ?? h.grant).enabled,
    })),
  ];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-100">
          {t("fixbug.policy.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          {t("fixbug.policy.lede")}
          <span className="text-rose-300"> {t("fixbug.policy.sudoNote")}</span>
        </p>
      </section>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <label className="block text-xs text-slate-500">
          {t("fixbug.policy.pickServer")}
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-2 w-full max-w-md rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label} · {auth(target.enabled)}
              </option>
            ))}
          </select>
        </label>
        {sshHosts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {t("fixbug.policy.onlyLocal")}{" "}
            <Link href="/hosts" className="text-teal-300 hover:underline">
              {t("fixbug.nav.hosts")}
            </Link>
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => setSelected(target.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  selected === target.id
                    ? "border-teal-400/60 bg-teal-400/10 text-teal-100"
                    : "border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                {target.label}
                <span
                  className={`ml-1.5 ${target.enabled ? "text-teal-400" : "text-slate-600"}`}
                >
                  {auth(target.enabled)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={onSave} className="space-y-5">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-teal-400/20 bg-teal-400/5 px-4 py-3">
          <input
            type="checkbox"
            checked={currentGrant.enabled}
            onChange={(e) => patchGrant({ enabled: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-medium text-slate-100">
              {t("fixbug.policy.grantTitle")}{" "}
              {selected === "local"
                ? localLabel
                : (sshHosts.find((h) => h.id === selected)?.name ?? selected)}
            </span>
            <span className="text-xs text-slate-500">{t("fixbug.policy.grantOffHint")}</span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          {grantToggles.map((row) => (
            <label
              key={row.key}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3 ${
                !currentGrant.enabled ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                disabled={!currentGrant.enabled}
                checked={Boolean(currentGrant[row.key])}
                onChange={(e) =>
                  patchGrant({ [row.key]: e.target.checked } as Partial<TargetGrant>)
                }
                className="mt-1"
              />
              <span>
                <span className="block text-sm text-slate-100">{row.label}</span>
                <span className="text-xs text-slate-500">{row.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="block text-xs text-slate-400">
          {t("fixbug.policy.maxRisk")}
          <select
            value={currentGrant.maxAutoFixRisk}
            disabled={!currentGrant.enabled}
            onChange={(e) =>
              patchGrant({
                maxAutoFixRisk: e.target.value as TargetGrant["maxAutoFixRisk"],
              })
            }
            className="mt-1 w-full max-w-md rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
          >
            <option value="none">{t("fixbug.policy.riskNone")}</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
          </select>
        </label>

        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
          <h2 className="text-sm font-medium text-slate-200">{t("fixbug.policy.globalSection")}</h2>
          <p className="mt-1 text-xs text-slate-500">{t("fixbug.policy.globalHint")}</p>

          <label className="mt-4 block text-xs text-slate-400">
            {t("fixbug.policy.writablePaths")}
            <textarea
              value={policy.shared.allowedPaths.join("\n")}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  shared: {
                    ...policy.shared,
                    allowedPaths: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              rows={4}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </label>

          <label className="mt-3 block text-xs text-slate-400">
            {t("fixbug.policy.cmdPrefixes")}
            <textarea
              value={policy.shared.allowedCommands.join("\n")}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  shared: {
                    ...policy.shared,
                    allowedCommands: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              rows={5}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </label>
        </div>

        <div className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-100/90">
          <div className="font-medium text-rose-200">{t("fixbug.policy.hardDenyTitle")}</div>
          <p className="mt-1 text-rose-100/70">{t("fixbug.policy.hardDenyBody")}</p>
        </div>

        {examples && selected === "local" && (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
            <div className="mb-2 text-slate-300">{t("fixbug.policy.dryRunTitle")}</div>
            {Object.entries(examples).map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="w-28 font-mono text-slate-500">{k}</span>
                <span className={v.allowed ? "text-teal-300" : "text-rose-300"}>
                  {v.allowed ? t("fixbug.common.allow") : t("fixbug.common.deny")}
                </span>
                <span>{v.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-teal-500/90 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-teal-400"
          >
            {t("fixbug.policy.savePolicy")}
          </button>
          {message && <span className="text-sm text-teal-300">{message}</span>}
        </div>
      </form>
    </div>
  );
}
