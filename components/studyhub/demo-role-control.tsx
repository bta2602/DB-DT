'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { Role } from '@/lib/studyhub/api-contract';
import { roles } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';

const demoRoles: Role[] = ['student', 'teacher', 'admin'];

export function DemoRoleControl({
  compact = false,
  disabled = false,
}: {
  compact?: boolean;
  disabled?: boolean;
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
      router.replace(session.user?.role === 'admin' ? '/overview' : '/today');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось переключить роль.');
    }
  }

  return (
    <section
      className={`demo-role-control ${compact ? 'compact' : ''}`}
      aria-labelledby={labelId}
      aria-busy={switchingRole}
    >
      <strong className="demo-role-label" id={labelId}>
        {compact ? 'Демо-роль' : 'Попробуйте StudyHUB'}
      </strong>
      {!compact && (
        <p className="demo-role-description">
          Выберите роль и откройте учебное пространство без регистрации.
        </p>
      )}
      <div className="demo-role-options" role="group" aria-label="Выбор демонстрационной роли">
        {demoRoles.map((role) => (
          <button
            type="button"
            key={role}
            className={`demo-role-button ${user?.role === role ? 'active' : ''}`}
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
      {!compact && (
        <p className="small muted">
          Это демонстрационные аккаунты. Изменения в данных сохраняются.
        </p>
      )}
      {error && (
        <p className="demo-role-error error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
