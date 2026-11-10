'use client';

import { useI18n } from './preferences';

export type FavoriteButtonProps = {
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

export function FavoriteButton({ selected, onToggle, disabled = false }: FavoriteButtonProps) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="button small favorite-button"
      aria-pressed={selected}
      title={selected ? t('Убрать из избранного') : t('Добавить в избранное')}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="favorite-button-icon" aria-hidden="true">
        {selected ? '★' : '☆'}
      </span>
      <span className="favorite-button-label">
        {t('Избранное')}
        {selected && <small aria-hidden="true">{t('В избранном')}</small>}
      </span>
    </button>
  );
}
