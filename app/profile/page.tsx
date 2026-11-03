import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { ProfilePage } from '@/components/studyhub/student-pages';

export async function generateMetadata() {
  return pageMetadata('Профиль');
}

export default function Page() {
  return (
    <StudyHubApp section="profile">
      <ProfilePage />
    </StudyHubApp>
  );
}
