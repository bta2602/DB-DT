export type SortDirection = 'asc' | 'desc';
export type SortState = { key: string; direction: SortDirection };
export type SortValue = string | number | null | undefined;

export function nextSort(previous: SortState, key: string): SortState {
  return { key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' };
}

/** Sort the whole filtered collection before pagination. Empty cells stay last. */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState,
  getValue: (row: T, key: string) => SortValue,
  locale = 'ru',
): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const missing = (value: SortValue) =>
    value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  return rows
    .map((row, index) => ({ row, index, value: getValue(row, sort.key) }))
    .sort((a, b) => {
      if (missing(a.value) || missing(b.value)) {
        return Number(missing(a.value)) - Number(missing(b.value)) || a.index - b.index;
      }
      const comparison =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return (sort.direction === 'desc' ? -comparison : comparison) || a.index - b.index;
    })
    .map(({ row }) => row);
}
