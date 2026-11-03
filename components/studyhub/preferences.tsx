'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  normalizeLocale,
  normalizeTheme,
  translate,
  type Locale,
  type Theme,
  type TranslationValues,
} from '@/lib/studyhub/i18n';

type Preferences = {
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
  t: (source: string, values?: TranslationValues) => string;
};
const PreferencesContext = createContext<Preferences | null>(null);

function persist(name: string, value: string) {
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  try {
    localStorage.setItem(name, value);
  } catch {
    // A blocked storage API should not prevent changing the interface.
  }
}

export function PreferencesProvider({
  children,
  initialLocale = 'ru',
  initialTheme = 'light',
}: {
  children: ReactNode;
  initialLocale?: Locale;
  initialTheme?: Theme;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const [theme, updateTheme] = useState(initialTheme);
  const setLocale = useCallback((value: Locale) => {
    const next = normalizeLocale(value);
    updateLocale(next);
    document.documentElement.lang = next;
    persist(LOCALE_COOKIE, next);
  }, []);
  const setTheme = useCallback((value: Theme) => {
    const next = normalizeTheme(value);
    updateTheme(next);
    document.documentElement.dataset.theme = next;
    persist(THEME_COOKIE, next);
  }, []);
  const t = useCallback(
    (source: string, values?: TranslationValues) => translate(source, locale, values),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, theme, setLocale, setTheme, t }),
    [locale, theme, setLocale, setTheme, t],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useI18n() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('PreferencesProvider is required');
  return context;
}
