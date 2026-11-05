import type { Viewport } from 'next';
import { pageMetadata } from '@/lib/studyhub/page-metadata';
import { cookies } from 'next/headers';
import { StudyHubProvider } from '@/components/studyhub/context';
import { TeacherWorkspaceProvider } from '@/components/studyhub/teacher-context';
import { PreferencesProvider } from '@/components/studyhub/preferences';
import { SkipLink } from '@/components/studyhub/preference-controls';
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  normalizeLocale,
  normalizeTheme,
  translate,
} from '@/lib/studyhub/i18n';
import { bootstrapFor, isDemoEnabled, readSession } from '@/lib/studyhub/auth-store.mjs';
import { emptyData } from '@/lib/studyhub/client-utils';
import type { Bootstrap, Session } from '@/lib/studyhub/api-contract';
import './styles/tokens.css';
import './styles/styles.css';
import './styles/teacher.css';
import './styles/admin.css';
import './styles/publication.css';
import './globals.css';
import './styles/preferences.css';
import './styles/dark.css';

export async function generateMetadata() {
  return pageMetadata('Учебное пространство');
}
export const viewport: Viewport = { themeColor: '#2f6355' };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const theme = normalizeTheme(cookieStore.get(THEME_COOKIE)?.value);
  const token = cookieStore.get('studyhub_session')?.value;
  const stored = token ? await readSession(token) : null;
  const initialSession = stored
    ? ({
        user: stored.user,
        csrfToken: stored.csrfToken,
        demoEnabled: await isDemoEnabled(),
      } as Session)
    : null;
  const initialData: Bootstrap = stored?.user
    ? JSON.parse(JSON.stringify(await bootstrapFor(stored.user)))
    : emptyData();
  // eslint-disable-next-line react-hooks/purity -- A single request-time clock snapshot is serialized for identical SSR and hydration.
  const initialNow = Date.now();
  return (
    <html lang={locale} data-theme={theme}>
      <body>
        <PreferencesProvider initialLocale={locale} initialTheme={theme}>
          <SkipLink />
          <StudyHubProvider
            initialSession={initialSession}
            initialData={initialData}
            initialNow={initialNow}
          >
            <TeacherWorkspaceProvider>{children}</TeacherWorkspaceProvider>
          </StudyHubProvider>
        </PreferencesProvider>
        <noscript>
          {translate('Для работы StudyHUB включите JavaScript в браузере.', locale)}
        </noscript>
      </body>
    </html>
  );
}
