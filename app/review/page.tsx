import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { ReviewPage } from '@/components/studyhub/teacher-pages';

export const metadata = { title: 'StudyHUB · Проверка работ' };

export default function Page() {
  return (
    <StudyHubApp section="review">
      <ReviewPage />
    </StudyHubApp>
  );
}
