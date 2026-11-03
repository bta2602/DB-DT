import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { SubjectsPage } from '@/components/studyhub/student-pages';

export const metadata = { title: 'StudyHUB · Предметы' };

export default function Page() {
  return (
    <StudyHubApp section="subjects">
      <SubjectsPage />
    </StudyHubApp>
  );
}
