import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AssignmentsPage } from '@/components/studyhub/teacher-pages';

export const metadata = { title: 'StudyHUB · Мои задания' };

export default function Page() {
  return (
    <StudyHubApp section="assignments">
      <AssignmentsPage />
    </StudyHubApp>
  );
}
