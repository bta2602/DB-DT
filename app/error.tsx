'use client';

import Link from 'next/link';
import { useI18n } from '@/components/studyhub/preferences';

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="route-state" id="main">
      <h1>{t('Не удалось открыть страницу')}</h1>
      <p>{t('Попробуйте ещё раз. Сохранённые данные останутся в базе.')}</p>
      <div className="flex">
        <button className="button primary" onClick={reset}>
          {t('Повторить')}
        </button>
        <Link className="button" href="/">
          {t('На главную')}
        </Link>
      </div>
    </main>
  );
}
