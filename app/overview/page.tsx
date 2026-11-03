import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AdminOverview } from '@/components/studyhub/admin-pages';

export const metadata = { title: 'StudyHUB · Обзор занятий' };

export default function Page() {
  return (
    <StudyHubApp section="overview">
      <AdminOverview />
    </StudyHubApp>
  );
}
