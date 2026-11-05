'use client';

import { useI18n } from './preferences';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { Role } from '@/lib/studyhub/api-contract';
import { roles } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';

const demoRoles: Role[] = ['student', 'teacher', 'admin'];

export function DemoRoleControl({
  inAccount = false,
  disabled = false,
  onSelected,
}: {
  inAccount?: boolean;
  disabled?: boolean;
  onSelected?: () => void;
}) {
  const { t } = useI18n();
  const { user, demoEnabled, ready, switchRole, switchingRole } = useStudyHub();
  const router = useRouter();
  const labelId = useId();
  const [error, setError] = useState('');

  if (!demoEnabled) return null;

  async function chooseRole(role: Role) {
    setError('');
    try {
      const session = await switchRole(role);
      onSelected?.();
      router.replace(session.user?.role === 'admin' ? '/overview' : '/today');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Не удалось переключить роль.'));
    }
  }

  return (
    <section
      className={`role-control ${inAccount ? 'in-account' : ''}`}
      aria-labelledby={labelId}
      aria-busy={switchingRole}
    >
      <strong className="role-control-label" id={labelId}>
        {inAccount ? t('Выбрать роль') : t('Учебный доступ')}
      </strong>
      {!inAccount && (
        <p className="role-control-description">
          {t('Выберите роль и откройте учебное пространство без регистрации.')}
        </p>
      )}
      <div className="role-control-options" role="group" aria-label={t('Выбор роли')}>
        {demoRoles.map((role) => (
          <button
            type="button"
            key={role}
            className={`role-control-button ${user?.role === role ? 'active' : ''}`}
            aria-pressed={user?.role === role}
            disabled={disabled || !ready || switchingRole}
            onClick={() => void chooseRole(role)}
          >
            {t(roles[role])}
          </button>
        ))}
      </div>
      {switchingRole && (
        <span className="small muted" role="status">
          {t('Открываем кабинет…')}
        </span>
      )}
      {error && (
        <p className="role-control-error error-text" role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}
