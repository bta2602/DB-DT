import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { TasksPage } from '@/components/studyhub/student-pages';

export const metadata = { title: 'StudyHUB · Задания' };

export default function Page() {
  return (
    <StudyHubApp section="tasks">
      <TasksPage />
    </StudyHubApp>
  );
}
