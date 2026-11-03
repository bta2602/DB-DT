import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AboutPage } from '@/components/studyhub/student-pages';

export const metadata = { title: 'StudyHUB · О проекте' };

export default function Page() {
  return (
    <StudyHubApp section="about">
      <AboutPage />
    </StudyHubApp>
  );
}
