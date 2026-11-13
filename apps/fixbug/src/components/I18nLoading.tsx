"use client";

import { useAppI18n } from "@/lib/app-i18n";

export function I18nLoading() {
  const { t } = useAppI18n();
  return <p className="text-slate-500">{t("fixbug.common.loading")}</p>;
}
