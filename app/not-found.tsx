'use client';

import Link from 'next/link';
import { useI18n } from '@/components/studyhub/preferences';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="route-state" id="main">
      <p className="eyebrow">StudyHUB · 404</p>
      <h1>{t('Страница не найдена')}</h1>
      <p>{t('Проверьте адрес или вернитесь в свой кабинет.')}</p>
      <Link className="button primary" href="/">
        {t('На главную')}
      </Link>
    </main>
  );
}
