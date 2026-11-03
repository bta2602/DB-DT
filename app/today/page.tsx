import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { TodayPage } from '@/components/studyhub/today-page';

export async function generateMetadata() {
  return pageMetadata('Сегодня');
}

export default function Page() {
  return (
    <StudyHubApp section="today">
      <TodayPage />
    </StudyHubApp>
  );
}
