import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AssignmentsPage } from '@/components/studyhub/teacher-pages';

export async function generateMetadata() {
  return pageMetadata('Мои задания');
}

export default function Page() {
  return (
    <StudyHubApp section="assignments">
      <AssignmentsPage />
    </StudyHubApp>
  );
}
