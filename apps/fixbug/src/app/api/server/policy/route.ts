import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkAction,
  HARD_DENIED_COMMAND_PREFIXES,
} from "@/lib/agent-policy";
import {
  getEffectiveCapabilitiesForTarget,
  getServerPolicyDocument,
  saveServerPolicyDocument,
} from "@/lib/server-policy-store";
import {
  serverPolicyDocumentSchema,
  targetGrantSchema,
} from "@/lib/server-target-policy";
import { listSshHostsPublic } from "@/lib/ssh/store";

export const runtime = "nodejs";

const putSchema = z.object({
  policy: serverPolicyDocumentSchema.optional(),
  /** 兼容旧客户端：仅更新 capabilities 时写入本机 + shared */
  capabilities: z.unknown().optional(),
});

export async function GET() {
  const policy = getServerPolicyDocument();
  const sshHosts = listSshHostsPublic().map((h) => ({
    id: h.id,
    name: h.name,
    grant: policy.hosts[h.id] ?? { enabled: false, canAnalyze: true },
  }));

  const localCaps = getEffectiveCapabilitiesForTarget("local");

  return NextResponse.json({
    policy,
    sshHosts,
    /** 兼容旧字段 */
    capabilities: localCaps,
    hardDenies: {
      commands: HARD_DENIED_COMMAND_PREFIXES,
      note: "sudo / 提权类命令不可通过策略放开",
    },
    examples: {
      local_analyze: checkAction("analyze", localCaps),
      local_run_df: checkAction("run_command", localCaps, { command: "df -h" }),
      sudo: checkAction("run_command", localCaps, {
        command: "sudo apt update",
      }),
      apply_config: checkAction("apply_local_fix", localCaps, {
        path: "/etc/nginx/nginx.conf",
        risk: "low",
      }),
    },
  });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "权限配置无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.policy) {
    const doc = serverPolicyDocumentSchema.parse(parsed.data.policy);
    const shared = {
      ...doc.shared,
      canOpenPr: false,
      deniedCommands: Array.from(
        new Set([
          ...doc.shared.deniedCommands,
          "sudo",
          "su",
          "doas",
          "pkexec",
          "visudo",
          "passwd",
        ]),
      ),
    };
    saveServerPolicyDocument({ ...doc, shared });
  } else if (body.capabilities) {
    const { saveServerCapabilities } = await import("@/lib/server-policy-store");
    const { agentCapabilitiesSchema } = await import("@/lib/agent-policy");
    const capParsed = agentCapabilitiesSchema.safeParse(body.capabilities ?? body);
    if (!capParsed.success) {
      return NextResponse.json(
        { error: "权限配置无效", details: capParsed.error.flatten() },
        { status: 400 },
      );
    }
    saveServerCapabilities(capParsed.data);
  } else {
    return NextResponse.json({ error: "需要 policy 或 capabilities" }, { status: 400 });
  }

  const policy = getServerPolicyDocument();
  return NextResponse.json({
    policy,
    capabilities: getEffectiveCapabilitiesForTarget("local"),
    message: "已保存。每台服务器需单独开启「授权访问」后，分析与 SSH 才会生效。",
  });
}

/** 单台主机 grant 快速更新 */
export async function PATCH(request: Request) {
  const body = await request.json();
  const schema = z.object({
    target: z.enum(["local"]).or(z.string().min(1)),
    grant: targetGrantSchema,
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const doc = getServerPolicyDocument();
  const grant = targetGrantSchema.parse(parsed.data.grant);
  if (parsed.data.target === "local") {
    saveServerPolicyDocument({ ...doc, local: grant });
  } else {
    saveServerPolicyDocument({
      ...doc,
      hosts: { ...doc.hosts, [parsed.data.target]: grant },
    });
  }

  return NextResponse.json({
    grant,
    message: "已更新该服务器授权",
  });
}
