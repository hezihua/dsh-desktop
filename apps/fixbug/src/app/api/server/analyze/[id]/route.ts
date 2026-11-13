import { NextResponse } from "next/server";
import { getServerReport } from "@/lib/server-report-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const report = getServerReport(id);
  if (!report) {
    return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  }
  return NextResponse.json({ report });
}
