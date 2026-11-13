import fs from "node:fs";
import path from "node:path";
import { fixbugDataDir } from "@/lib/data-root";
import { createId } from "@/lib/id";
import type { ServerAnalysisReport } from "@/lib/server-analyze";

const reportsPath =
  process.env.SERVER_ANALYSIS_STORE_PATH ??
  path.join(fixbugDataDir(), "server-analysis.json");

const MAX_REPORTS = 500;

function ensureDataDir() {
  const dir = path.dirname(reportsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

type StoredReport = ServerAnalysisReport & {
  id: string;
  createdAt: string;
};

function readAll(): StoredReport[] {
  ensureDataDir();
  if (!fs.existsSync(reportsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(reportsPath, "utf8")) as StoredReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(reports: StoredReport[]) {
  ensureDataDir();
  fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2), "utf8");
}

export function listServerReports(): StoredReport[] {
  return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getServerReport(id: string): StoredReport | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function appendServerReport(report: ServerAnalysisReport): StoredReport {
  const row: StoredReport = {
    ...report,
    id: createId("sar"),
    createdAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
  const next = [row, ...readAll()].slice(0, MAX_REPORTS);
  writeAll(next);
  return row;
}

export function deleteServerReports(ids: string[]): number {
  if (ids.length === 0) return 0;
  const drop = new Set(ids);
  const all = readAll();
  const next = all.filter((r) => !drop.has(r.id));
  const removed = all.length - next.length;
  if (removed > 0) writeAll(next);
  return removed;
}
