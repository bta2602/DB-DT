'use client';

import '@/app/styles/lesson-tools.css';
import { useId, useState, type ReactNode } from 'react';
import { lessonToolsLabels } from '@/lib/studyhub/lesson-tools-labels';
import { useI18n } from './preferences';

export type SearchOption = { id: string; name: string; search?: string; disabled?: boolean };

/** Search reduces a native select; keyboard navigation and mobile pickers stay native. */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  selectedOption,
  disabled = false,
  required = false,
  children,
  name,
}: {
  label: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  selectedOption?: SearchOption;
  disabled?: boolean;
  required?: boolean;
  children?: ReactNode;
  name?: string;
}) {
  const id = useId();
  const { locale } = useI18n();
  const labels = lessonToolsLabels[locale];
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase(locale);
  const matches = options.filter((option) =>
    `${option.name} ${option.search || ''}`.toLocaleLowerCase(locale).includes(normalized),
  );
  const selected = value
    ? options.find((option) => option.id === value) ||
      (selectedOption?.id === value ? selectedOption : undefined)
    : undefined;
  const outside = selected && !matches.some((option) => option.id === value);
  return (
    <div className="field search-select">
      <label htmlFor={`${id}-select`}>{label}</label>
      {children}
      <div className="search-select-search">
        <input
          type="search"
          value={query}
          disabled={disabled}
          aria-label={`${labels.search}: ${label}`}
          placeholder={`${labels.search}: ${label.toLocaleLowerCase(locale)}`}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="button small"
            disabled={disabled}
            onClick={() => setQuery('')}
            aria-label={`${labels.reset}: ${label}`}
          >
            ×
          </button>
        )}
      </div>
      <select
        id={`${id}-select`}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-count`}
      >
        <option value="">{placeholder}</option>
        {outside && (
          <option value={selected.id} disabled={selected.disabled}>
            {selected.name} ({labels.selected})
          </option>
        )}
        {matches.map((option) => (
          <option key={option.id} value={option.id} disabled={option.disabled}>
            {option.name}
          </option>
        ))}
      </select>
      <small id={`${id}-count`} className="muted" aria-live="polite">
        {matches.length ? `${labels.matches}: ${matches.length}` : labels.nothing}
      </small>
    </div>
  );
}
