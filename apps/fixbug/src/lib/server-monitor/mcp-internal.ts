import { getEffectiveCapabilitiesForTarget } from "@/lib/server-policy-store";
import { executeMonitorTool } from "@/lib/server-monitor/tools";

export async function executeServerInternalTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ output: string }> {
  const rawHost = args.targetHostId;
  const targetHostId =
    typeof rawHost === "string" && rawHost.trim() ? rawHost.trim() : undefined;
  const scope = targetHostId ?? "local";
  const caps = getEffectiveCapabilitiesForTarget(scope);
  const ctx = { caps, hostId: targetHostId ?? null };

  switch (name) {
    case "server_agent_health":
      return {
        output: JSON.stringify({
          ok: true,
          app: "infini-ops-agent",
          target: targetHostId ?? "local",
        }),
      };

    case "server_host_overview":
      return {
        output: await executeMonitorTool("host_overview", {}, ctx),
      };

    case "server_disk_usage":
      return {
        output: await executeMonitorTool("disk_usage", {}, ctx),
      };

    case "server_process_top": {
      const limit = typeof args.limit === "number" ? args.limit : 15;
      return {
        output: await executeMonitorTool("process_top", { limit }, ctx),
      };
    }

    case "server_tail_log": {
      const path = String(args.path ?? "/var/log/syslog");
      const lines = typeof args.lines === "number" ? args.lines : 50;
      return {
        output: await executeMonitorTool(
          "tail_system_log",
          { path, lines },
          ctx,
        ),
      };
    }

    case "server_read_config": {
      const path = String(args.path ?? "");
      if (!path) throw new Error("path 必填");
      return {
        output: await executeMonitorTool("read_config", { path }, ctx),
      };
    }

    case "server_journal_tail": {
      const lines = typeof args.lines === "number" ? args.lines : 80;
      return {
        output: await executeMonitorTool("journal_tail", { lines }, ctx),
      };
    }

    default:
      throw new Error(`未知工具: ${name}`);
  }
}

export const serverInternalToolNames = [
  "server_agent_health",
  "server_host_overview",
  "server_disk_usage",
  "server_process_top",
  "server_tail_log",
  "server_read_config",
  "server_journal_tail",
] as const;
