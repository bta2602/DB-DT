import { cookies } from 'next/headers';
import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { LOCALE_COOKIE, normalizeLocale } from '@/lib/studyhub/i18n';
import { campusLabels } from '@/lib/studyhub/campus-labels';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AcademicSettings } from '@/components/studyhub/academic-settings';

export async function generateMetadata() {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return pageMetadata(campusLabels[locale].academic);
}

export default function Page() {
  return (
    <StudyHubApp section="academic">
      <AcademicSettings />
    </StudyHubApp>
  );
}
