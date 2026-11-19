'use client';

import { useId } from 'react';
import type { User } from '@/lib/studyhub/api-contract';
import { splitLegacyName } from '@/lib/studyhub/user-names.mjs';
import { useI18n } from './preferences';

const fields = [
  { key: 'familyName', label: 'Фамилия', autocomplete: 'family-name', required: true },
  { key: 'givenName', label: 'Имя', autocomplete: 'given-name', required: true },
  {
    key: 'patronymic',
    label: 'Отчество (если есть)',
    autocomplete: 'additional-name',
    required: false,
  },
] as const;

type NameParts = Record<(typeof fields)[number]['key'], string>;
type NameSource = Pick<User, 'name' | keyof NameParts>;

export function readUserName(form: FormData): NameParts {
  return {
    familyName: String(form.get('familyName') ?? '').trim(),
    givenName: String(form.get('givenName') ?? '').trim(),
    patronymic: String(form.get('patronymic') ?? '').trim(),
  };
}

export function UserNameFields({
  user,
  errors = {},
  disabled = false,
}: {
  user?: NameSource;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const prefix = useId();
  const initial = user?.familyName || user?.givenName ? user : splitLegacyName(user?.name);

  return (
    <div className="user-name-fields">
      {fields.map(({ key, label, autocomplete, required }) => {
        const id = `${prefix}-${key}`;
        const error = errors[key];
        return (
          <div className="field auth-field" key={key}>
            <label htmlFor={id}>{t(label)}</label>
            <input
              id={id}
              name={key}
              autoComplete={autocomplete}
              defaultValue={initial?.[key] ?? ''}
              required={required}
              disabled={disabled}
              maxLength={60}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            {error && (
              <span id={`${id}-error`} className="auth-field-error">
                {t(error)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
