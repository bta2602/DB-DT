'use client';

import type { SortState } from '@/lib/studyhub/table-sort';
import { useI18n } from './preferences';

const labels = {
  ru: { asc: 'По возрастанию', desc: 'По убыванию' },
  kk: { asc: 'Өсу ретімен', desc: 'Кему ретімен' },
  en: { asc: 'Sort ascending', desc: 'Sort descending' },
};

export function SortHeading({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: string;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const { locale } = useI18n();
  const active = sort.key === column;
  const next = active && sort.direction === 'asc' ? 'desc' : 'asc';
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
      >
        {label}{' '}
        <span aria-hidden="true">{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}
