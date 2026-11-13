import { NextResponse } from "next/server";
import { isInternalApiRequestAuthorized } from "@/lib/internal-api-auth";
import { executeServerInternalTool } from "@/lib/server-monitor/mcp-internal";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isInternalApiRequestAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const name = String(body.name || "");
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const args = (body.arguments ?? {}) as Record<string, unknown>;
    const result = await executeServerInternalTool(name, args);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[internal/mcp-tool]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tool execution failed" },
      { status: 500 },
    );
  }
}
