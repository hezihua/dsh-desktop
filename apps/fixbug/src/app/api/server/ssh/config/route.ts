import { NextResponse } from "next/server";
import { readEditableConfigFile } from "@/lib/ssh/store";

export const runtime = "nodejs";

/** 读取可编辑的 SSH 配置文件内容（用于 UI 编辑器） */
export async function GET() {
  const file = readEditableConfigFile();
  return NextResponse.json(file);
}
