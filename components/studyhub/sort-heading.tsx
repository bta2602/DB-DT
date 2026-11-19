'use client';

import type { SortState } from '@/lib/studyhub/table-sort';
import { useI18n } from './preferences';
import { Icon } from './shared';

const labels = {
  ru: { asc: 'По возрастанию', desc: 'По убыванию' },
  kk: { asc: 'Өсу ретімен', desc: 'Кему ретімен' },
  en: { asc: 'Sort ascending', desc: 'Sort descending' },
};

export function SortHeading({
  label,
  detail,
  column,
  sort,
  onSort,
}: {
  label: string;
  detail?: string;
  column: string;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const { locale } = useI18n();
  const active = sort.key === column;
  const next = active && sort.direction === 'asc' ? 'desc' : 'asc';
  const icon = active ? (sort.direction === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort';
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="sort-heading"
        onClick={() => onSort(column)}
        aria-label={`${label}: ${labels[locale][next]}`}
        title={detail}
      >
        {label}
        <Icon name={icon} className="sm" />
      </button>
    </th>
  );
}
