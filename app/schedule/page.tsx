import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { SchedulePage } from '@/components/studyhub/admin-pages';

export async function generateMetadata() {
  return pageMetadata('Расписание');
}

export default function Page() {
  return (
    <StudyHubApp section="schedule">
      <SchedulePage />
    </StudyHubApp>
  );
}
