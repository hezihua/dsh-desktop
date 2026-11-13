"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppI18n } from "@/lib/app-i18n";

type Report = {
  id: string;
  createdAt: string;
  summary: string;
  severity: string;
  status: "ok" | "error";
  batchId?: string;
  target: { type: string; label: string; hostId?: string };
  errorMessage?: string;
  host: { hostname: string; load1: number; memUsedRatio: number; diskAlert: boolean };
  findings: Array<{ area: string; detail: string; confidence: number }>;
  rootCauseHypotheses: string[];
  solutions: Array<{ title: string; steps: string[]; risk: string; automatable: boolean }>;
  nextHumanDecision: string[];
  automations: Array<{ id: string; title: string; command?: string; description: string }>;
  evidence?: { message?: string; stackExcerpt?: string };
};

const severityColor: Record<string, string> = {
  low: "text-teal-300",
  medium: "text-amber-300",
  high: "text-rose-300",
  critical: "text-rose-400",
};

export function ServerAnalysisView() {
  const { t } = useAppI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportIdFromUrl = searchParams.get("id");

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const selectedId = reportIdFromUrl ?? null;

  const load = useCallback(async () => {
    const res = await fetch("/api/server/analyze");
    const data = await res.json();
    setReports(data.reports ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const batches = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) {
      if (r.batchId) set.add(r.batchId);
    }
    return [...set];
  }, [reports]);

  const filtered = useMemo(() => {
    if (!batchFilter) return reports;
    return reports.filter((r) => r.batchId === batchFilter);
  }, [reports, batchFilter]);

  const current = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? null,
    [reports, selectedId],
  );

  async function runFleetAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/server/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "fleet" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("fixbug.analysis.analyzeFailed"));
      await load();
      if (data.reports?.[0]?.id) {
        router.push(`/analysis?id=${data.reports[0].id}`);
      }
      if (data.failed > 0) {
        setError(
          t("fixbug.analysis.batchPartialFail", {
            batchId: String(data.batchId),
            failed: String(data.failed),
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function openReport(id: string) {
    router.push(`/analysis?id=${id}`);
  }

  function backToList() {
    router.push("/analysis");
  }

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  async function deleteReports(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(t("fixbug.analysis.confirmDelete", { count: String(ids.length) }))) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/server/analyze", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("fixbug.analysis.deleteFailed"));
      setReports(data.reports ?? []);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (selectedId && ids.includes(selectedId)) {
        router.push("/analysis");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (selectedId && current) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={backToList}
            className="text-sm text-teal-300 hover:text-teal-200"
          >
            {t("fixbug.common.backToList")}
          </button>
          <button
            type="button"
            onClick={() => deleteReports([current.id])}
            disabled={deleting}
            className="text-sm text-rose-300/90 hover:text-rose-200 disabled:opacity-50"
          >
            {t("fixbug.common.deleteReport")}
          </button>
        </div>
        <ReportDetail report={current} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-100">
            {t("fixbug.analysis.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{t("fixbug.analysis.lede")}</p>
        </div>
        <button
          type="button"
          onClick={runFleetAnalysis}
          disabled={loading}
          className="rounded-md bg-teal-500/90 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-50"
        >
          {loading ? t("fixbug.analysis.analyzing") : t("fixbug.analysis.runFleet")}
        </button>
      </section>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        {batches.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            {t("fixbug.analysis.filterBatch")}
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-slate-200"
            >
              <option value="">{t("fixbug.common.all")}</option>
              {batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => deleteReports([...selectedIds])}
            disabled={deleting}
            className="rounded-md border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"
          >
            {deleting
              ? t("fixbug.common.deleting")
              : t("fixbug.common.deleteSelected", { count: String(selectedIds.size) })}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                  }}
                  onChange={toggleSelectAllFiltered}
                  aria-label={t("fixbug.common.selectAll")}
                  className="rounded border-white/20 bg-black/40"
                />
              </th>
              <th className="px-4 py-3">{t("fixbug.common.time")}</th>
              <th className="px-4 py-3">{t("fixbug.common.server")}</th>
              <th className="px-4 py-3">{t("fixbug.common.status")}</th>
              <th className="px-4 py-3">{t("fixbug.common.severity")}</th>
              <th className="px-4 py-3">{t("fixbug.common.summary")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-white/5 hover:bg-white/[0.03]"
                onClick={() => openReport(r.id)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    aria-label={t("fixbug.common.selectRow", {
                      name: r.target?.label ?? r.host.hostname,
                    })}
                    className="rounded border-white/20 bg-black/40"
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{r.createdAt}</td>
                <td className="px-4 py-3 text-slate-200">{r.target?.label ?? r.host.hostname}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      r.status === "error" ? "text-rose-300" : "text-teal-300"
                    }
                  >
                    {r.status === "error" ? t("fixbug.common.failed") : t("fixbug.common.ok")}
                  </span>
                </td>
                <td className={`px-4 py-3 uppercase text-xs ${severityColor[r.severity] ?? ""}`}>
                  {r.severity}
                </td>
                <td className="max-w-md truncate px-4 py-3 text-slate-400">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-6 text-sm text-slate-600">
            {t("fixbug.analysis.emptyList")}
          </p>
        )}
      </div>

      <p className="text-xs text-slate-600">
        {t("fixbug.analysis.cronHint")}{" "}
        <Link href="/automation" className="text-teal-400/80 hover:underline">
          {t("fixbug.nav.automation")}
        </Link>
        ；{t("fixbug.analysis.cronDefault")}
      </p>
    </div>
  );
}

function ReportDetail({ report }: { report: Report }) {
  const { t } = useAppI18n();
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg text-slate-100">
          {report.target?.label ?? report.host.hostname}
        </h2>
        <span
          className={`text-xs ${report.status === "error" ? "text-rose-300" : "text-teal-300"}`}
        >
          {report.status === "error" ? t("fixbug.common.analyzeFailed") : t("fixbug.common.analyzeSuccess")}
        </span>
        <span className={`text-xs uppercase ${severityColor[report.severity] ?? "text-slate-400"}`}>
          {report.severity}
        </span>
        <span className="text-xs text-slate-500">{report.createdAt}</span>
        {report.batchId && (
          <span className="font-mono text-xs text-slate-600">
            {t("fixbug.common.batch")} {report.batchId}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm text-slate-300">{report.summary}</p>
      {report.errorMessage && (
        <pre className="mt-3 overflow-x-auto rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">
          {report.errorMessage}
        </pre>
      )}

      <section className="mt-6">
        <h3 className="text-sm font-medium text-slate-200">{t("fixbug.common.findings")}</h3>
        <ul className="mt-2 space-y-2 text-sm text-slate-400">
          {report.findings.map((f, i) => (
            <li key={i}>
              <span className="text-teal-300/90">{f.area}</span> — {f.detail}
            </li>
          ))}
        </ul>
      </section>

      {report.evidence?.stackExcerpt && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-slate-200">{t("fixbug.common.evidence")}</h3>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-400">
            {report.evidence.stackExcerpt}
          </pre>
        </section>
      )}

      {report.rootCauseHypotheses.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-slate-200">{t("fixbug.common.hypotheses")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
            {report.rootCauseHypotheses.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {report.solutions.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-slate-200">{t("fixbug.common.solutions")}</h3>
          <div className="mt-2 space-y-3">
            {report.solutions.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/5 bg-black/20 p-3 text-sm">
                <div className="text-slate-200">{s.title}</div>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-500">
                  {s.steps.map((step, j) => (
                    <li key={j}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
