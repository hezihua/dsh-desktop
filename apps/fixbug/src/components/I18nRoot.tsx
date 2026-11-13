'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/app-i18n';

export function I18nRoot({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
