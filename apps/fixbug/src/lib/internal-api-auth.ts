/** Harness 插件 → `/api/internal/mcp-tool` 鉴权（与 infini-harness INTERNAL_API_TOKEN 一致） */

export function getInternalApiToken(): string | undefined {
  const token = process.env.INTERNAL_API_TOKEN?.trim();
  return token || undefined;
}

export function isInternalApiRequestAuthorized(req: {
  headers: { get(name: string): string | null };
}): boolean {
  const expected = getInternalApiToken();
  if (expected) {
    return req.headers.get("x-internal-token") === expected;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.DESKTOP_BUNDLED_FIXBUG !== "1"
  ) {
    return false;
  }

  const host = req.headers.get("host") || "";
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const isLocalHost =
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]");
  const isLocalForwarded =
    forwarded === "127.0.0.1" ||
    forwarded.startsWith("127.0.0.1,") ||
    forwarded === "::1";

  return isLocalHost || isLocalForwarded;
}
