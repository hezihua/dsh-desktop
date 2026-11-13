import { NextResponse } from "next/server";
import { z } from "zod";
import { sshHostSchema } from "@/lib/ssh/types";
import {
  deleteSshHost,
  getPrimaryConfigPath,
  listSshHostsPublic,
  readEditableConfigFile,
  resolveSshConfigPaths,
  syncFromConfigFiles,
  upsertSshHost,
  writeConfigFile,
} from "@/lib/ssh/store";

export const runtime = "nodejs";

const upsertSchema = sshHostSchema.partial({ id: true });

const configBodySchema = z.object({
  content: z.string().max(200_000),
});

export async function GET(request: Request) {
  const sync = new URL(request.url).searchParams.get("sync") === "1";
  if (sync) syncFromConfigFiles();

  const file = readEditableConfigFile();
  const loaded = syncFromConfigFiles();

  return NextResponse.json({
    hosts: listSshHostsPublic(),
    config: {
      primaryPath: getPrimaryConfigPath(),
      editablePath: file.path,
      exists: file.exists,
      resolvedPaths: resolveSshConfigPaths(),
      loadedFromPaths: loaded.paths,
      hostCountFromConfig: loaded.loaded,
    },
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "config") {
    const body = configBodySchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "content 无效" }, { status: 400 });
    }
    try {
      const result = writeConfigFile(body.data.content);
      return NextResponse.json({
        ok: true,
        path: result.path,
        hostCount: result.count,
        hosts: listSshHostsPublic(),
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "写入失败" },
        { status: 400 },
      );
    }
  }

  if (action === "sync") {
    const result = syncFromConfigFiles();
    return NextResponse.json({
      ok: true,
      loaded: result.loaded,
      paths: result.paths,
      hosts: listSshHostsPublic(),
    });
  }

  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const host = upsertSshHost(parsed.data);
  return NextResponse.json({
    host: {
      id: host.id,
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      privateKeyPath: host.privateKeyPath,
      source: "manual",
    },
  });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }
  if (!deleteSshHost(id)) {
    return NextResponse.json(
      { error: "无法删除：主机来自配置文件，请编辑 data/ssh-hosts.conf 或 SERVER_SSH_CONFIG" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
