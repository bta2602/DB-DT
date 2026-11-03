import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { PeoplePage } from '@/components/studyhub/admin-pages';

export const metadata = { title: 'StudyHUB · Пользователи и группы' };

export default function Page() {
  return (
    <StudyHubApp section="people">
      <PeoplePage />
    </StudyHubApp>
  );
}
