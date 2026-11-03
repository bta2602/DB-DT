import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { RoomsPage } from '@/components/studyhub/admin-pages';

export const metadata = { title: 'StudyHUB · Аудитории' };

export default function Page() {
  return (
    <StudyHubApp section="rooms">
      <RoomsPage />
    </StudyHubApp>
  );
}
