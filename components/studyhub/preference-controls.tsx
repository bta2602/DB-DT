'use client';

import { useId } from 'react';
import { useI18n } from './preferences';
import type { Locale } from '@/lib/studyhub/i18n';

export function SkipLink() {
  const { t } = useI18n();
  return (
    <a className="skip" href="#main">
      {t('Перейти к содержимому')}
    </a>
  );
}

export function PreferenceControls() {
  const { t, locale, setLocale, theme, setTheme } = useI18n();
  const id = useId();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const themeLabel = t(theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
  return (
    <div className="preference-controls" role="group" aria-label={t('Настройки интерфейса')}>
      <label className="sr-only" htmlFor={id}>
        {t('Язык интерфейса')}
      </label>
      <select id={id} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
        <option value="ru" lang="ru">
          Русский
        </option>
        <option value="kk" lang="kk">
          Қазақша
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
      <button
        type="button"
        className="theme-toggle"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={() => setTheme(nextTheme)}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          {theme === 'dark' ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
            </>
          ) : (
            <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />
          )}
        </svg>
      </button>
    </div>
  );
}
