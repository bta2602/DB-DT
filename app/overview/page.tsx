import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { AdminOverview } from '@/components/studyhub/admin-pages';

export async function generateMetadata() {
  return pageMetadata('Обзор занятий');
}

export default function Page() {
  return (
    <StudyHubApp section="overview">
      <AdminOverview />
    </StudyHubApp>
  );
}
