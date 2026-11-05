import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { StudyHubApp } from '@/components/studyhub/studyhub-app';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/studyhub/auth-store.mjs';

export async function generateMetadata() {
  return pageMetadata('Вход');
}

export default async function Page() {
  const token = (await cookies()).get('studyhub_session')?.value;
  const user = token ? (await readSession(token))?.user : null;
  if (user) redirect(user.role === 'admin' ? '/overview' : '/today');
  return <StudyHubApp section="login" />;
}
