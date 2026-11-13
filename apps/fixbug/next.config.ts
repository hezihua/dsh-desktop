import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");
const desktopI18nFile = path.join(appDir, "src/desktop-i18n/context.tsx");
const desktopI18nAlias = `./${path.relative(appDir, desktopI18nFile).replace(/\\/g, "/")}`;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  typescript: {
    // monorepo：@desktop/i18n 引入根目录 zh/en 字面量类型与 fixbug 不一致
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    config.resolve.alias ??= {};
    config.resolve.alias["@desktop/i18n"] = desktopI18nFile;
    return config;
  },
  turbopack: {
    resolveAlias: {
      "@desktop/i18n": desktopI18nAlias,
    },
  },
  redirects: async () => [
    { source: "/projects", destination: "/monitor", permanent: false },
    { source: "/logs", destination: "/monitor", permanent: false },
    { source: "/tickets", destination: "/monitor", permanent: false },
    { source: "/reports", destination: "/analysis", permanent: false },
    { source: "/dashboard", destination: "/monitor", permanent: false },
  ],
};

export default nextConfig;
