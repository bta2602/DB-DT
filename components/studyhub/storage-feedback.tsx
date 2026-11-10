'use client';

import type { BrowserStorageStatus } from '@/lib/studyhub/browser-storage';
import { useI18n } from './preferences';

const messages = {
  ru: {
    loading: 'Восстанавливаем сохранённые данные…',
    saved: 'Сохранено в этом браузере.',
    invalid: 'Сохранённые данные повреждены или устарели. Используются начальные значения.',
    unavailable:
      'Хранилище браузера недоступно. Изменения могут потеряться после закрытия страницы.',
    error: 'Не удалось сохранить в браузере. Проверьте свободное место и настройки хранилища.',
  },
  kk: {
    loading: 'Сақталған деректер қалпына келтірілуде…',
    saved: 'Осы браузерде сақталды.',
    invalid: 'Сақталған деректер бүлінген немесе ескірген. Бастапқы мәндер қолданылды.',
    unavailable: 'Браузер қоймасы қолжетімсіз. Бет жабылғанда өзгерістер жоғалуы мүмкін.',
    error: 'Браузерде сақтау мүмкін болмады. Бос орынды және қойма баптауларын тексеріңіз.',
  },
  en: {
    loading: 'Restoring saved data…',
    saved: 'Saved in this browser.',
    invalid: 'Saved data is invalid or outdated. Using the initial values.',
    unavailable: 'Browser storage is unavailable. Changes may be lost when this page closes.',
    error: 'Could not save in the browser. Check free space and storage settings.',
  },
};

export function StorageFeedback({ status }: { status: BrowserStorageStatus }) {
  const { locale } = useI18n();
  if (status === 'loaded' || status === 'empty') return null;
  const failed = status === 'invalid' || status === 'unavailable' || status === 'error';
  return (
    <p className={`small ${failed ? 'error-text' : 'muted'}`} role="status">
      {messages[locale][status]}
    </p>
  );
}
