'use client';

import { useId } from 'react';
import { useI18n } from './preferences';
import { Icon } from './shared';
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
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </div>
  );
}
