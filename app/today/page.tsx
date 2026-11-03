import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { TodayPage } from '@/components/studyhub/today-page';

export const metadata = { title: 'StudyHUB · Сегодня' };

export default function Page() {
  return (
    <StudyHubApp section="today">
      <TodayPage />
    </StudyHubApp>
  );
}
