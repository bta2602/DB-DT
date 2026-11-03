'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, Suspense, useEffect, useState, type ReactNode } from 'react';
import { formatDate, dateKey, initials, roles } from '@/lib/studyhub/client-utils';
import type { Role } from '@/lib/studyhub/api-contract';
import { useStudyHub } from './context';
import { AuthPage } from './auth-page';
import { DemoRoleControl } from './demo-role-control';
import { Brand, EmptyState, Icon } from './shared';

const titles: Record<string, string> = {
  today: 'Сегодня',
  overview: 'Обзор занятий',
  schedule: 'Расписание',
  rooms: 'Аудитории',
  people: 'Пользователи и группы',
  journal: 'Журнал',
  review: 'Проверка работ',
  assignments: 'Мои задания',
  subjects: 'Предметы',
  tasks: 'Задания',
  profile: 'Профиль',
  about: 'О проекте',
};
const menus: Record<Role, [string, string][]> = {
  admin: [
    ['overview', 'grid'],
    ['schedule', 'calendar'],
    ['rooms', 'building'],
    ['people', 'users'],
  ],
  teacher: [
    ['today', 'home'],
    ['journal', 'book'],
    ['review', 'tasks'],
    ['assignments', 'file'],
    ['schedule', 'calendar'],
  ],
  student: [
    ['today', 'home'],
    ['schedule', 'calendar'],
    ['subjects', 'book'],
    ['tasks', 'tasks'],
  ],
};

// Pages pass their content to this shell, so navigation can load each route separately.
export function StudyHubApp({
  section = '',
  children,
}: {
  section?: string;
  children?: ReactNode;
}) {
  const { user, data, ready, error, now, request, reloadSession, refresh, notify, switchingRole } =
    useStudyHub();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const page = section || (user?.role === 'admin' ? 'overview' : 'today');

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  useEffect(() => {
    const legacy = window.location.hash.slice(1);
    if (titles[legacy] || legacy === 'register') router.replace('/' + legacy);
  }, [router]);

  async function logout() {
    setBusy(true);
    try {
      await request('/api/auth/logout', { method: 'POST', body: {} });
      await reloadSession();
      router.replace('/login');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Не удалось выйти.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshData() {
    setBusy(true);
    try {
      await refresh();
      notify('Данные обновлены.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Не удалось обновить данные.');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    if (section === 'about') {
      return (
        <main id="main" className="guest-about">
          <Link className="button mb" href="/login">
            Войти в StudyHUB
          </Link>
          {children}
        </main>
      );
    }
    return (
      <AuthPage
        key={section === 'register' ? 'register' : 'login'}
        register={section === 'register'}
        returnPath={section && !['login', 'register'].includes(section) ? '/' + section : '/'}
      />
    );
  }
  if (!ready || ['login', 'register'].includes(section)) {
    return (
      <main id="main" className="boot-state" role="status">
        Открываем StudyHUB…
      </main>
    );
  }

  const nav = menus[user.role];
  const allowed = nav.some(([item]) => item === page) || ['profile', 'about'].includes(page);
  const waiting = data.submissions.filter((submission) => submission.status === 'submitted').length;
  const workspaceDescription =
    user.role === 'teacher'
      ? 'Журнал и проверка работ'
      : user.role === 'admin'
        ? 'Управление платформой'
        : data.groups.find((group) => group.id === user.groupId)?.name || 'Личный кабинет';

  return (
    <>
      <button
        type="button"
        className={`mobile-nav-shade ${menu ? 'open' : ''}`}
        onClick={() => setMenu(false)}
        aria-label="Закрыть меню"
        tabIndex={menu ? 0 : -1}
      />
      <aside
        className={`sidebar ${menu ? 'open' : ''}`}
        id="main-navigation"
        aria-label="Главная навигация"
      >
        <Brand />
        <div className="workspace">
          <span className="workspace-logo">
            <Icon name="building" className="sm" />
          </span>
          <div>
            <strong>Учебное пространство</strong>
            <small>{workspaceDescription}</small>
          </div>
        </div>
        <div className="eyebrow nav-label">
          {user.role === 'admin' ? 'Администрирование' : 'Личный кабинет'}
        </div>
        <nav className="nav-list">
          {nav.map(([item, icon]) => (
            <Link
              key={item}
              href={'/' + item}
              className={`nav-item ${page === item ? 'active' : ''}`}
              aria-current={page === item ? 'page' : undefined}
              onClick={() => setMenu(false)}
            >
              <Icon name={icon} />
              {titles[item]}
              {item === 'review' && waiting > 0 && <span className="nav-count">{waiting}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <Link
          className={`nav-item ${page === 'about' ? 'active' : ''}`}
          href="/about"
          aria-current={page === 'about' ? 'page' : undefined}
          onClick={() => setMenu(false)}
        >
          <Icon name="info" />О проекте
        </Link>
        <div className="sidebar-note">
          <div className="eyebrow">Меньше хаоса. Больше ясности.</div>
          <p>
            Всё, что нужно для учёбы,
            <br />
            теперь в одном месте.
          </p>
        </div>
        <Link
          className="profile-btn"
          href="/profile"
          aria-current={page === 'profile' ? 'page' : undefined}
          onClick={() => setMenu(false)}
        >
          <span className="avatar teacher">{initials(user.name)}</span>
          <span className="grow">
            <strong>{user.name}</strong>
            <small>{roles[user.role]}</small>
          </span>
          <Icon name="chevron" className="sm" />
        </Link>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="flex">
            <button
              type="button"
              className="icon-btn mobile-menu"
              aria-label="Открыть меню"
              aria-controls="main-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumb">
              <span>Личный кабинет</span>
              <Icon name="chevron" className="sm" />
              <strong>{titles[page] || 'StudyHUB'}</strong>
            </div>
          </div>
          <div className="top-actions">
            <DemoRoleControl compact disabled={busy} />
            <span className="user-role">{roles[user.role]}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Обновить данные"
              disabled={busy || switchingRole}
              onClick={() => void refreshData()}
            >
              <Icon name="clock" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Выйти"
              disabled={busy || switchingRole}
              onClick={() => void logout()}
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main
          id="main"
          className={`content ${user.role === 'teacher' ? 'teacher-content' : ''}`}
          tabIndex={-1}
        >
          {error && (
            <div className="publication-error" role="alert">
              {error}
            </div>
          )}
          {data.announcements.some((item) => item.id === 'demo-notice-fiction') && (
            <div className="publication-hint" role="note">
              <strong>В базе есть демонстрационные данные.</strong> Записи с пометкой «демо» и
              связанные с ними пользователи и работы вымышлены. Изменения сохраняются.
            </div>
          )}
          <Suspense fallback={<p role="status">Загрузка раздела…</p>}>
            {allowed ? (
              <Fragment key={user.id}>{children}</Fragment>
            ) : (
              <EmptyState
                title="Раздел недоступен"
                description="Этот раздел доступен другой роли. Выберите страницу в меню."
              />
            )}
          </Suspense>
          <footer className="page-footer">
            <span>
              <Icon name="book" className="sm" /> StudyHUB · Учебная информация в одном месте
            </span>
            <span>{formatDate(dateKey(new Date(now)))}</span>
          </footer>
        </main>
      </div>
    </>
  );
}
