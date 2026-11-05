import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { TasksPage } from '@/components/studyhub/student-pages';

export async function generateMetadata() {
  return pageMetadata('Задания');
}

export default function Page() {
  return (
    <StudyHubApp section="tasks">
      <TasksPage />
    </StudyHubApp>
  );
}
