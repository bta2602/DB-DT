import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { StudyHubProvider } from '@/components/studyhub/context';
import { TeacherWorkspaceProvider } from '@/components/studyhub/teacher-pages';
import { bootstrapFor, readSession } from '@/lib/studyhub/auth-store.mjs';
import { emptyData } from '@/lib/studyhub/client-utils';
import type { Bootstrap, Session } from '@/lib/studyhub/api-contract';
import './styles/styles.css';
import './styles/teacher.css';
import './styles/admin.css';
import './styles/publication.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'StudyHUB · Учебное пространство',
  description: 'Расписание, задания, оценки и посещаемость в одном учебном пространстве.',
};
export const viewport: Viewport = { themeColor: '#2f6355' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('studyhub_session')?.value;
  const stored = token ? readSession(token) : null;
  const initialSession = stored ? { user: stored.user, csrfToken: stored.csrfToken } as Session : null;
  const initialData: Bootstrap = stored?.user ? JSON.parse(JSON.stringify(bootstrapFor(stored.user))) : emptyData();
  // eslint-disable-next-line react-hooks/purity -- A single request-time clock snapshot is serialized for identical SSR and hydration.
  const initialNow = Date.now();
  return <html lang="ru"><body><a className="skip" href="#main">Перейти к содержимому</a><StudyHubProvider initialSession={initialSession} initialData={initialData} initialNow={initialNow}><TeacherWorkspaceProvider>{children}</TeacherWorkspaceProvider></StudyHubProvider><noscript>Для работы StudyHUB включите JavaScript в браузере.</noscript></body></html>;
}
