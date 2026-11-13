"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAppI18n } from "@/lib/app-i18n";

type SkillSummary = {
  name: string;
  description: string;
  triggers: string[];
  source: string;
  path: string;
  readonly: boolean;
};

type SkillDetail = SkillSummary & { body: string };

export function SkillsView() {
  const { t } = useAppI18n();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    triggers: "",
    body: "",
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/skills");
    const data = await res.json();
    setSkills(data.skills ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    fetch(`/api/skills/${selected}`)
      .then((r) => r.json())
      .then((d) => setDetail(d.skill ?? null));
  }, [selected]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        triggers: form.triggers
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        body: form.body,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? t("fixbug.skills.createFailed"));
      return;
    }
    setMessage(t("fixbug.skills.created", { name: data.skill?.name ?? form.name }));
    setShowForm(false);
    setForm({ name: "", description: "", triggers: "", body: "" });
    await load();
    setSelected(data.skill?.name ?? form.name);
  }

  async function remove(name: string) {
    if (!confirm(t("fixbug.skills.confirmDelete", { name }))) return;
    const res = await fetch(`/api/skills/${name}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? t("fixbug.skills.deleteFailed"));
      return;
    }
    setSelected(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-100">
          {t("fixbug.skills.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{t("fixbug.skills.lede")}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-teal-500/90 px-3 py-1.5 text-sm text-slate-950 hover:bg-teal-400"
        >
          {showForm ? t("fixbug.common.cancel") : t("fixbug.skills.newSkill")}
        </button>
        {message && <span className="self-center text-sm text-teal-300">{message}</span>}
      </div>

      {showForm && (
        <form
          onSubmit={onCreate}
          className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2"
        >
          <label className="block text-xs text-slate-400">
            name（slug）
            <input
              required
              pattern="[a-z0-9-]+"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-xs text-slate-400">
            description
            <input
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-400 sm:col-span-2">
            {t("fixbug.skills.triggers")}
            <input
              value={form.triggers}
              onChange={(e) => setForm((f) => ({ ...f, triggers: e.target.value }))}
              placeholder="磁盘, df, no space"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-400 sm:col-span-2">
            {t("fixbug.skills.body")}
            <textarea
              required
              rows={8}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-white/10 px-4 py-2 text-sm sm:col-span-2"
          >
            {t("fixbug.skills.saveSkill")}
          </button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10">
          {skills.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => setSelected(s.name)}
                className={`w-full px-3 py-3 text-left ${
                  selected === s.name ? "bg-teal-400/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <div className="font-mono text-sm text-teal-200">{s.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-500">{s.description}</div>
                <div className="mt-1 text-[10px] text-slate-600">
                  {s.source} {s.readonly ? t("fixbug.skills.readonly") : t("fixbug.skills.deletable")}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          {!detail && <p className="text-sm text-slate-500">{t("fixbug.skills.selectHint")}</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg text-slate-100">{detail.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">{detail.description}</p>
                  {detail.triggers.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      triggers: {detail.triggers.join(", ")}
                    </p>
                  )}
                </div>
                {!detail.readonly && (
                  <button
                    type="button"
                    onClick={() => remove(detail.name)}
                    className="text-xs text-rose-300 hover:underline"
                  >
                    {t("fixbug.common.delete")}
                  </button>
                )}
              </div>
              <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 text-xs leading-relaxed text-slate-300">
                {detail.body}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
