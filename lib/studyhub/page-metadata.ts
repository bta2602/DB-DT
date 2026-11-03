import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, translate } from './i18n';

export async function pageMetadata(title: string): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  return {
    title: `StudyHUB · ${translate(title, locale)}`,
    description: translate(
      'Расписание, задания и единый журнал оценок в одном учебном пространстве.',
      locale,
    ),
  };
}
