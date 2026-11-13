"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { isDesktopHarnessShell } from "@/lib/desktop-harness-chat";
import { useAppI18n } from "@/lib/app-i18n";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const desktopShell = isDesktopHarnessShell();
  const { t } = useAppI18n();

  const nav = useMemo(
    () => [
      { href: "/monitor", label: t("fixbug.nav.monitor") },
      { href: "/analysis", label: t("fixbug.nav.analysis") },
      { href: "/skills", label: t("fixbug.nav.skills") },
      { href: "/hosts", label: t("fixbug.nav.hosts") },
      { href: "/agent", label: t("fixbug.nav.agent") },
      { href: "/automation", label: t("fixbug.nav.automation") },
    ],
    [t],
  );

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(45,212,191,0.08),_transparent_50%),linear-gradient(180deg,#0b1220_0%,#0a0f18_100%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <Link href="/" className="group flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-teal-300 transition group-hover:text-teal-200">
              {t("fixbug.brand")}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {t("fixbug.brandAgent")}
            </span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    active
                      ? "bg-teal-400/15 text-teal-200"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        {desktopShell ? (
          <p className="mb-4 rounded-lg border border-teal-400/25 bg-teal-400/10 px-3 py-2 text-xs text-teal-100/90">
            {t("fixbug.desktopEmbedNote")}
          </p>
        ) : null}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
