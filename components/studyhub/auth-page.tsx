'use client';

import { useI18n } from './preferences';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, useStudyHub } from './context';
import { Brand, Icon } from './shared';
import { DemoRoleControl } from './demo-role-control';

function AuthField({
  name,
  label,
  type = 'text',
  hint,
  error,
  ...props
}: {
  name: string;
  label: string;
  type?: string;
  hint?: string;
  error?: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const password = type === 'password';
  return (
    <div className="field auth-field">
      <label htmlFor={`auth-${name}`}>{label}</label>
      <div className={password ? 'auth-password-control' : 'auth-input-control'}>
        <input
          id={`auth-${name}`}
          name={name}
          type={password && visible ? 'text' : type}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={`auth-${name}-error${hint ? ` auth-${name}-hint` : ''}`}
          {...props}
        />
        {password && (
          <button
            type="button"
            className="auth-password-toggle"
            onClick={() => setVisible(!visible)}
            aria-pressed={visible}
            aria-label={t(
              name === 'passwordConfirmation'
                ? visible
                  ? 'Скрыть повтор пароля'
                  : 'Показать повтор пароля'
                : visible
                  ? 'Скрыть пароль'
                  : 'Показать пароль',
            )}
          >
            {visible ? t('Скрыть') : t('Показать')}
          </button>
        )}
      </div>
      {hint && (
        <small className="auth-field-hint" id={`auth-${name}-hint`}>
          {hint}
        </small>
      )}
      <span
        id={`auth-${name}-error`}
        className="auth-field-error"
        aria-live="polite"
        hidden={!error}
      >
        {error ? t(error) : null}
      </span>
    </div>
  );
}
export function AuthPage({
  register = false,
  returnPath = '/',
}: {
  register?: boolean;
  returnPath?: string;
}) {
  const { t } = useI18n();
  const { request, reloadSession, ready, switchingRole, error: sessionError } = useStudyHub();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || switchingRole || !ready) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim(),
      password = String(form.get('password') || '');
    const name = String(form.get('name') || '').trim(),
      passwordConfirmation = String(form.get('passwordConfirmation') || '');
    setError('');
    setFields({});
    setBusy(true);
    try {
      if (register && password !== passwordConfirmation)
        throw new ApiError(t('Пароли не совпадают.'), 422, {
          passwordConfirmation: t('Повторите тот же пароль.'),
        });
      await request(`/api/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: register ? { name, email, password, passwordConfirmation } : { email, password },
      });
      const session = await reloadSession();
      const home = session.user?.role === 'admin' ? '/overview' : '/today';
      router.replace(returnPath === '/' ? home : returnPath + window.location.search);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Не удалось войти.'));
      if (cause instanceof ApiError) setFields(cause.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className={`publication-login ${register ? 'registration-page' : ''}`}>
      <section className="login-story">
        <Brand />
        <div className="login-story-copy">
          <div className="eyebrow">{t('Учебная информация в одном месте')}</div>
          <h1>
            {t('Твой день.')}
            <br />
            {t('Твой ритм.')}
          </h1>
          <p>
            {t(
              'Расписание, задания и результаты учёбы — в одном пространстве, где легко найти главное.',
            )}
          </p>
          <div className="login-book-art" aria-hidden="true">
            <div className="banner-art">
              <div className="banner-orbit" />
              <div className="book book-back" />
              <div className="book" />
              <span className="art-check">
                <Icon name="check" />
              </span>
              <span className="spark">✦</span>
            </div>
          </div>
          <div className="login-benefits">
            <span>
              <Icon name="calendar" />
              {t('Расписание')}
            </span>
            <span>
              <Icon name="tasks" />
              {t('Задания')}
            </span>
            <span>
              <Icon name="chart" />
              {t('Результаты')}
            </span>
          </div>
        </div>
        <small>{t('Меньше хаоса. Больше ясности.')}</small>
      </section>
      <section className="login-form-panel">
        <div className="login-form-inner">
          <nav className="auth-mode-switch" aria-label={t('Доступ к аккаунту')}>
            <Link
              href="/login"
              className={!register ? 'active' : ''}
              aria-current={!register ? 'page' : undefined}
            >
              {t('Вход')}
            </Link>
            <Link
              href="/register"
              className={register ? 'active' : ''}
              aria-current={register ? 'page' : undefined}
            >
              {t('Регистрация')}
            </Link>
          </nav>
          <div className="eyebrow">{register ? t('Начнём знакомство') : t('С возвращением')}</div>
          <h2 id="auth-title">{register ? t('Создать аккаунт') : t('Войти в StudyHUB')}</h2>
          <p className="muted">
            {register
              ? t('Твоё учебное пространство начинается здесь.')
              : t('Продолжи с того места, где остановился.')}
          </p>
          {sessionError && (
            <div className="publication-error" role="alert">
              <span>{t(sessionError)}</span>
              <button
                type="button"
                className="button small"
                onClick={() => void reloadSession().catch((cause) => setError(cause.message))}
              >
                {t('Повторить')}
              </button>
            </div>
          )}
          <DemoRoleControl disabled={busy} />
          <form
            className="auth-form"
            onSubmit={submit}
            aria-labelledby="auth-title"
            aria-busy={busy}
          >
            {register && (
              <AuthField
                name="name"
                label={t('Имя и фамилия')}
                autoComplete="name"
                maxLength={120}
                error={fields.name}
                placeholder={t('Как к вам обращаться')}
              />
            )}
            <AuthField
              name="email"
              label={t('Электронная почта')}
              type="email"
              autoComplete="username"
              maxLength={254}
              error={fields.email}
              placeholder="name@college.kz"
            />
            <AuthField
              name="password"
              label={t('Пароль')}
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={register ? 12 : undefined}
              maxLength={128}
              error={fields.password}
              placeholder={register ? t('Придумайте пароль') : t('Введите пароль')}
              hint={
                register
                  ? t('От 12 до 128 символов. Можно использовать слова и пробелы.')
                  : undefined
              }
            />
            {register && (
              <AuthField
                name="passwordConfirmation"
                label={t('Повторите пароль')}
                type="password"
                autoComplete="new-password"
                maxLength={128}
                error={fields.passwordConfirmation}
                placeholder={t('Введите пароль ещё раз')}
              />
            )}
            <p className="error-text" role="alert">
              {t(error)}
            </p>
            <button
              className="button primary full"
              type="submit"
              disabled={busy || switchingRole || !ready}
            >
              {busy
                ? register
                  ? t('Создаём аккаунт…')
                  : t('Входим…')
                : register
                  ? t('Создать аккаунт')
                  : t('Войти')}{' '}
              <Icon name="arrow" className="sm" />
            </button>
          </form>
          <p className="auth-switch-help">
            {register ? t('Уже есть аккаунт?') : t('Ещё нет аккаунта?')}{' '}
            <Link className="text-link" href={register ? '/login' : '/register'}>
              {register ? t('Войти') : t('Зарегистрироваться')}
            </Link>
          </p>
          <p className="login-help">
            {register
              ? t(
                  'После регистрации откроется личный кабинет студента. Группу и доступ преподавателя назначает администратор.',
                )
              : t(
                  'Войдите с почтой и паролем своего аккаунта. Если вы преподаватель, права доступа назначает администратор.',
                )}
          </p>
        </div>
        <footer>StudyHUB</footer>
      </section>
    </main>
  );
}
