import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { SubjectsPage } from '@/components/studyhub/student-pages';

export async function generateMetadata() {
  return pageMetadata('Предметы');
}

export default function Page() {
  return (
    <StudyHubApp section="subjects">
      <SubjectsPage />
    </StudyHubApp>
  );
}
