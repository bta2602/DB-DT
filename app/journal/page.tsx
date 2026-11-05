import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { JournalPage } from '@/components/studyhub/teacher-pages';

export async function generateMetadata() {
  return pageMetadata('Журнал');
}

export default function Page() {
  return (
    <StudyHubApp section="journal">
      <JournalPage />
    </StudyHubApp>
  );
}
