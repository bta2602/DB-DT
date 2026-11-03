import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { SchedulePage } from '@/components/studyhub/admin-pages';

export const metadata = { title: 'StudyHUB · Расписание' };

export default function Page() {
  return (
    <StudyHubApp section="schedule">
      <SchedulePage />
    </StudyHubApp>
  );
}
