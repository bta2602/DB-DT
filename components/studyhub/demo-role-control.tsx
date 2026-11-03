'use client';

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
      setError(cause instanceof Error ? cause.message : 'Не удалось переключить роль.');
    }
  }

  return (
    <section
      className={`role-control ${inAccount ? 'in-account' : ''}`}
      aria-labelledby={labelId}
      aria-busy={switchingRole}
    >
      <strong className="role-control-label" id={labelId}>
        {inAccount ? 'Выбрать роль' : 'Учебный доступ'}
      </strong>
      {!inAccount && (
        <p className="role-control-description">
          Выберите роль и откройте учебное пространство без регистрации.
        </p>
      )}
      <div className="role-control-options" role="group" aria-label="Выбор роли">
        {demoRoles.map((role) => (
          <button
            type="button"
            key={role}
            className={`role-control-button ${user?.role === role ? 'active' : ''}`}
            aria-pressed={user?.role === role}
            disabled={disabled || !ready || switchingRole}
            onClick={() => void chooseRole(role)}
          >
            {roles[role]}
          </button>
        ))}
      </div>
      {switchingRole && (
        <span className="small muted" role="status">
          Открываем кабинет…
        </span>
      )}
      {error && (
        <p className="role-control-error error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
