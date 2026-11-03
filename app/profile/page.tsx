import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { ProfilePage } from '@/components/studyhub/student-pages';

export const metadata = { title: 'StudyHUB · Профиль' };

export default function Page() {
  return (
    <StudyHubApp section="profile">
      <ProfilePage />
    </StudyHubApp>
  );
}
