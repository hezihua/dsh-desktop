import path from "node:path";

/** 安装包内写 userData；开发默认 apps/fixbug/data */
export function fixbugDataDir(): string {
  const fromEnv = process.env.FIXBUG_DATA_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "data");
}
