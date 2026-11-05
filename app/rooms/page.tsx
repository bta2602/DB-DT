import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { RoomsPage } from '@/components/studyhub/admin-pages';

export async function generateMetadata() {
  return pageMetadata('Аудитории');
}

export default function Page() {
  return (
    <StudyHubApp section="rooms">
      <RoomsPage />
    </StudyHubApp>
  );
}
