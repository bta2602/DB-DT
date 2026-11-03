import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { JournalPage } from '@/components/studyhub/teacher-pages';

export const metadata = { title: 'StudyHUB · Журнал' };

export default function Page() {
  return (
    <StudyHubApp section="journal">
      <JournalPage />
    </StudyHubApp>
  );
}
