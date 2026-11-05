'use client';

import { useI18n } from '@/components/studyhub/preferences';

export default function Loading() {
  const { t } = useI18n();
  return (
    <main className="route-state" role="status">
      {t('Загружаем раздел…')}
    </main>
  );
}
