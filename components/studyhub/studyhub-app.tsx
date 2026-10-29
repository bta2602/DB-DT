'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { formatDate, dateKey, initials, roles } from '@/lib/studyhub/client-utils';
import type { Role } from '@/lib/studyhub/api-contract';
import { useStudyHub } from './context';
import { AuthPage } from './auth-page';
import { Brand, EmptyState, Icon } from './shared';
import { AdminOverview, PeoplePage, RoomsPage, SchedulePage } from './admin-pages';
import { AssignmentsPage, JournalPage, ReviewPage, TeacherToday } from './teacher-pages';
import { AboutPage, ProfilePage, StudentToday, SubjectsPage, TasksPage } from './student-pages';

const titles: Record<string, string> = { today: 'Сегодня', overview: 'Обзор занятий', schedule: 'Расписание', rooms: 'Аудитории', people: 'Пользователи и группы', journal: 'Журнал', review: 'Проверка работ', assignments: 'Мои задания', subjects: 'Предметы', tasks: 'Задания', profile: 'Профиль', about: 'О проекте' };
const menus: Record<Role, [string, string][]> = {
  admin: [['overview', 'grid'], ['schedule', 'calendar'], ['rooms', 'building'], ['people', 'users']],
  teacher: [['today', 'home'], ['journal', 'book'], ['review', 'tasks'], ['assignments', 'file'], ['schedule', 'calendar']],
  student: [['today', 'home'], ['schedule', 'calendar'], ['subjects', 'book'], ['tasks', 'tasks']],
};
function PageContent({ page, role }: { page: string; role: Role }) {
  switch (page) {
    case 'overview': return <AdminOverview />;
    case 'people': return <PeoplePage />;
    case 'rooms': return <RoomsPage />;
    case 'schedule': return <SchedulePage />;
    case 'today': return role === 'teacher' ? <TeacherToday /> : <StudentToday />;
    case 'journal': return <JournalPage />;
    case 'review': return <ReviewPage />;
    case 'assignments': return <AssignmentsPage />;
    case 'subjects': return <SubjectsPage />;
    case 'tasks': return <TasksPage />;
    case 'profile': return <ProfilePage />;
    case 'about': return <AboutPage />;
    default: return <EmptyState title="Раздел не найден" />;
  }
}
export function StudyHubApp({ section = '' }: { section?: string }) {
  const { user, data, ready, error, now, request, reloadSession, refresh, notify } = useStudyHub();
  const router = useRouter();
  const [menu, setMenu] = useState(false), [busy, setBusy] = useState(false);
  const page = !section || section === 'login' || section === 'register' ? (user?.role === 'admin' ? 'overview' : 'today') : section;
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, []);
  useEffect(() => { const legacy = window.location.hash.slice(1); if (titles[legacy] || legacy === 'register') router.replace('/' + legacy); }, [router]);
  async function logout() {
    setBusy(true);
    try { await request('/api/auth/logout', { method: 'POST', body: {} }); await reloadSession(); router.replace('/login'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Не удалось выйти.'); }
    finally { setBusy(false); }
  }
  if (!user) {
    if (section === 'about') return <main id="main" className="guest-about"><Link className="button mb" href="/login">Войти в StudyHUB</Link><AboutPage /></main>;
    return <AuthPage key={section === 'register' ? 'register' : 'login'} register={section === 'register'} returnPath={section && !['login', 'register'].includes(section) ? '/' + section : '/'} />;
  }
  if (!ready) return <main id="main" className="boot-state" aria-live="polite">Загрузка StudyHUB…</main>;
  const nav = menus[user.role], allowed = nav.some(([item]) => item === page) || ['profile', 'about'].includes(page);
  const waiting = data.submissions.filter(submission => submission.status === 'submitted').length;
  return <>
    <button type="button" className={`mobile-nav-shade ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} aria-label="Закрыть меню" tabIndex={menu ? 0 : -1} />
    <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Главная навигация"><Brand /><div className="workspace"><span className="workspace-logo"><Icon name="building" className="sm" /></span><div><strong>Учебное пространство</strong><small>{user.role === 'teacher' ? 'Журнал и проверка работ' : user.role === 'admin' ? 'Управление платформой' : data.groups.find(group => group.id === user.groupId)?.name || 'Личный кабинет'}</small></div></div><div className="eyebrow nav-label">{user.role === 'admin' ? 'Администрирование' : 'Личный кабинет'}</div><nav className="nav-list">{nav.map(([item, icon]) => <Link key={item} href={'/' + item} className={`nav-item ${page === item ? 'active' : ''}`} aria-current={page === item ? 'page' : undefined} onClick={() => setMenu(false)}><Icon name={icon} />{titles[item]}{item === 'review' && waiting > 0 && <span className="nav-count">{waiting}</span>}</Link>)}</nav><div className="sidebar-spacer" /><Link className="nav-item" href="/about" onClick={() => setMenu(false)}><Icon name="info" />О проекте</Link><div className="sidebar-note"><div className="eyebrow">Меньше хаоса. Больше ясности.</div><p>Всё, что нужно для учёбы,<br />теперь в одном месте.</p></div><Link className="profile-btn" href="/profile" onClick={() => setMenu(false)}><span className="avatar teacher">{initials(user.name)}</span><span className="grow"><strong>{user.name}</strong><small>{roles[user.role]}</small></span><Icon name="chevron" className="sm" /></Link></aside>
    <div className="main-shell"><header className="topbar"><div className="flex"><button className="icon-btn mobile-menu" aria-label="Открыть меню" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="menu" /></button><div className="breadcrumb"><span>Личный кабинет</span><Icon name="chevron" className="sm" /><strong>{titles[page] || 'StudyHUB'}</strong></div></div><div className="top-actions"><span className="user-role">{roles[user.role]}</span><button className="icon-btn" aria-label="Обновить данные" disabled={busy} onClick={async () => { setBusy(true); try { await refresh(); notify('Данные обновлены.'); } catch (cause) { notify(cause instanceof Error ? cause.message : 'Не удалось обновить данные.'); } finally { setBusy(false); } }}><Icon name="clock" /></button><button className="icon-btn" aria-label="Выйти" disabled={busy} onClick={logout}><Icon name="logout" /></button></div></header>
      <main id="main" className={`content ${user.role === 'teacher' ? 'teacher-content' : ''}`} tabIndex={-1}>{error && <div className="publication-error" role="alert">{error}</div>}{data.announcements.some(item => item.id === 'demo-notice-fiction') && <div className="publication-hint" role="note"><strong>В базе есть демонстрационные данные.</strong> Записи с пометкой «демо» и связанные с ними пользователи и работы вымышлены. Изменения сохраняются.</div>}
        <Suspense fallback={<p role="status">Загрузка раздела…</p>}>{allowed ? <PageContent key={page} page={page} role={user.role} /> : <EmptyState title="Раздел недоступен" description="Этот раздел доступен другой роли. Выберите страницу в меню." />}</Suspense>
        <footer className="page-footer"><span><Icon name="book" className="sm" /> StudyHUB · Учебная информация в одном месте</span><span>{formatDate(dateKey(new Date(now)))}</span></footer>
      </main></div>
  </>;
}
