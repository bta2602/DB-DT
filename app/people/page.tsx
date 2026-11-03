import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { PeoplePage } from '@/components/studyhub/admin-pages';

export async function generateMetadata() {
  return pageMetadata('Пользователи и группы');
}

export default function Page() {
  return (
    <StudyHubApp section="people">
      <PeoplePage />
    </StudyHubApp>
  );
}
