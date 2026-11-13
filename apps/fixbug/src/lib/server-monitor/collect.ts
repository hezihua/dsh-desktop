import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertReadablePath } from "./access";

const MAX_TAIL_LINES = 200;
const MAX_FILE_BYTES = 256 * 1024;

function runArgv(argv: string[], timeoutMs = 8000): string {
  const res = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 512 * 1024,
  });
  if (res.error) {
    throw new Error(res.error.message);
  }
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(err || `命令退出码 ${res.status}`);
  }
  return (res.stdout || "").trim();
}

export function getHostOverview() {
  const load = os.loadavg();
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    uptimeSeconds: os.uptime(),
    loadAverage: { "1m": load[0], "5m": load[1], "15m": load[2] },
    cpu: {
      model: cpus[0]?.model ?? "unknown",
      cores: cpus.length,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
      usedBytes: os.totalmem() - os.freemem(),
    },
    node: process.version,
    cwd: process.cwd(),
    pid: process.pid,
  };
}

export function getMemoryDetail() {
  try {
    const raw = fs.readFileSync("/proc/meminfo", "utf8");
    const pick = (key: string) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? Number(m[1]) * 1024 : null;
    };
    return {
      memTotal: pick("MemTotal"),
      memAvailable: pick("MemAvailable"),
      memFree: pick("MemFree"),
      swapTotal: pick("SwapTotal"),
      swapFree: pick("SwapFree"),
    };
  } catch {
    return null;
  }
}

export function getDiskUsageText(): string {
  try {
    return runArgv(["df", "-h", "--output=source,size,used,avail,pcent,target"]);
  } catch (e) {
    return `无法读取磁盘: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function getNetworkListenersText(): string {
  try {
    return runArgv(["ss", "-tlnp"]);
  } catch {
    try {
      return runArgv(["netstat", "-tlnp"]);
    } catch (e) {
      return `无法读取监听端口: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

export function getProcessSnapshot(limit = 15): string {
  try {
    const out = runArgv(["ps", "aux", "--sort=-%mem"]);
    const lines = out.split("\n");
    return lines.slice(0, limit + 1).join("\n");
  } catch (e) {
    return `无法读取进程: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function tailLogFile(filePath: string, lines = 50): string {
  const n = Math.min(Math.max(lines, 1), MAX_TAIL_LINES);
  const check = assertReadablePath(filePath, "log");
  if (!check.ok) throw new Error(check.reason);

  if (!fs.existsSync(check.path)) {
    throw new Error(`文件不存在: ${check.path}`);
  }
  const stat = fs.statSync(check.path);
  if (!stat.isFile()) throw new Error("不是普通文件");

  try {
    return runArgv(["tail", "-n", String(n), check.path]);
  } catch {
    const buf = fs.readFileSync(check.path);
    const slice = buf.length > MAX_FILE_BYTES ? buf.subarray(buf.length - MAX_FILE_BYTES) : buf;
    const text = slice.toString("utf8");
    return text.split("\n").slice(-n).join("\n");
  }
}

export function readConfigFile(filePath: string): string {
  const check = assertReadablePath(filePath, "config");
  if (!check.ok) throw new Error(check.reason);
  if (!fs.existsSync(check.path)) throw new Error(`文件不存在: ${check.path}`);
  const stat = fs.statSync(check.path);
  if (!stat.isFile()) throw new Error("不是普通文件");
  if (stat.size > MAX_FILE_BYTES) {
    const fd = fs.openSync(check.path, "r");
    const buf = Buffer.alloc(MAX_FILE_BYTES);
    fs.readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
    fs.closeSync(fd);
    return buf.toString("utf8") + `\n\n…（已截断，文件约 ${stat.size} 字节）`;
  }
  return fs.readFileSync(check.path, "utf8");
}

export function listVarLog(limit = 40): string[] {
  const dir = "/var/log";
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(dir, d.name))
    .slice(0, limit);
}

export function readJournalTail(lines = 60): string {
  const n = Math.min(Math.max(lines, 1), MAX_TAIL_LINES);
  try {
    return runArgv(["journalctl", "-n", String(n), "--no-pager", "-o", "short-iso"]);
  } catch (e) {
    return `journalctl 不可用: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

export function formatOverviewMarkdown(): string {
  const o = getHostOverview();
  const memDetail = getMemoryDetail();
  const disk = getDiskUsageText();
  const lines = [
    `## 主机概览`,
    `- **主机名**: ${o.hostname}`,
    `- **系统**: ${o.platform}`,
    `- **运行时间**: ${Math.floor(o.uptimeSeconds / 3600)}h ${Math.floor((o.uptimeSeconds % 3600) / 60)}m`,
    `- **负载**: ${o.loadAverage["1m"].toFixed(2)} / ${o.loadAverage["5m"].toFixed(2)} / ${o.loadAverage["15m"].toFixed(2)}`,
    `- **CPU**: ${o.cpu.cores} 核 — ${o.cpu.model}`,
    `- **内存**: 已用 ${formatBytes(o.memory.usedBytes)} / 共 ${formatBytes(o.memory.totalBytes)}`,
  ];
  if (memDetail?.memAvailable != null) {
    lines.push(`- **可用内存**: ${formatBytes(memDetail.memAvailable)}`);
  }
  lines.push("", "## 磁盘 (df -h)", "```", disk, "```");
  return lines.join("\n");
}
