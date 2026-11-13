import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en, type MessageTree } from './en';
import { zh } from './zh';

export type UiLocale = 'en' | 'zh';

declare global {
  interface Window {
    infiniDesktop?: {
      getUiLocale?: () => Promise<UiLocale>;
      setUiLocale?: (locale: UiLocale) => Promise<UiLocale>;
    };
  }
}

const messages: Record<UiLocale, MessageTree> = { en, zh };

function officialLocale(): UiLocale | null {
  const value = process.env.NEXT_PUBLIC_UI_LOCALE;
  if (value === 'zh' || value === 'en') return value;
  return null;
}

type I18nContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => Promise<void>;
  t: (key: string, vars?: Record<string, string>) => string;
  agentLabel: (agentId: string, fallback: string) => string;
  agentDescription: (agentId: string, fallback?: string) => string | undefined;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getByPath(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = tree;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function format(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(() => officialLocale() ?? 'en');

  useEffect(() => {
    const fromOfficial = officialLocale();
    if (fromOfficial) {
      setLocaleState(fromOfficial);
      return;
    }
    void (async () => {
      if (typeof window !== 'undefined' && window.infiniDesktop?.getUiLocale) {
        setLocaleState(await window.infiniDesktop.getUiLocale());
        return;
      }
      const stored = localStorage.getItem('ui-locale');
      if (stored === 'zh' || stored === 'en') setLocaleState(stored);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback(async (next: UiLocale) => {
    if (typeof window !== 'undefined' && window.infiniDesktop?.setUiLocale) {
      const saved = await window.infiniDesktop.setUiLocale(next);
      localStorage.setItem('ui-locale', saved);
      setLocaleState(saved);
    } else {
      localStorage.setItem('ui-locale', next);
      setLocaleState(next);
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => {
      const raw = getByPath(messages[locale], key) ?? getByPath(messages.en, key) ?? key;
      return format(raw, vars);
    },
    [locale]
  );

  const agentLabel = useCallback(
    (agentId: string, fallback: string) => {
      const localized = getByPath(messages[locale], `agents.${agentId}.label`);
      return localized ?? fallback;
    },
    [locale]
  );

  const agentDescription = useCallback(
    (agentId: string, fallback?: string) => {
      const localized = getByPath(messages[locale], `agents.${agentId}.description`);
      return localized ?? fallback;
    },
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, agentLabel, agentDescription }),
    [locale, setLocale, t, agentLabel, agentDescription]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
