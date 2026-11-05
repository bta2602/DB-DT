import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { ReviewPage } from '@/components/studyhub/teacher-pages';

export async function generateMetadata() {
  return pageMetadata('Проверка работ');
}

export default function Page() {
  return (
    <StudyHubApp section="review">
      <ReviewPage />
    </StudyHubApp>
  );
}
