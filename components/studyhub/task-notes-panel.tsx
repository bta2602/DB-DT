'use client';

import { useId } from 'react';
import { useI18n } from './preferences';

export type TaskNotesValue = {
  note: string;
  completed: number[];
  stepsSignature: string;
};

export type TaskNotesPanelProps = {
  steps: string[];
  value: TaskNotesValue;
  onChange: (value: TaskNotesValue) => void;
  onClear: () => void;
  disabled?: boolean;
};

export function TaskNotesPanel({
  steps,
  value,
  onChange,
  onClear,
  disabled = false,
}: TaskNotesPanelProps) {
  const { t } = useI18n();
  const id = useId();
  const headingId = `${id}-heading`;
  const helpId = `${id}-help`;
  const noteId = `${id}-note`;
  const countId = `${id}-count`;
  const signature = JSON.stringify(steps);
  const completed = new Set(
    value.stepsSignature === signature
      ? value.completed.filter(
          (index) => Number.isInteger(index) && index >= 0 && index < steps.length,
        )
      : [],
  );

  function update(note: string, selected = completed) {
    onChange({
      note,
      completed: [...selected].sort((a, b) => a - b),
      stepsSignature: signature,
    });
  }

  function toggle(index: number) {
    const selected = new Set(completed);
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    update(value.note, selected);
  }

  return (
    <section className="drawer-section task-notes-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('Моя подготовка')}</h3>
      <p id={helpId}>
        {t('Личные записи сохраняются в этом браузере.')}{' '}
        {t('Личная подготовка не влияет на статус сдачи и оценку.')}
      </p>

      <fieldset
        disabled={disabled}
        className="task-notes-fields"
        aria-labelledby={headingId}
        aria-describedby={helpId}
      >
        <label className="field" htmlFor={noteId}>
          <span>{t('Моя заметка')}</span>
          <textarea
            id={noteId}
            value={value.note}
            maxLength={5000}
            rows={4}
            aria-describedby={countId}
            onChange={(event) => update(event.target.value)}
          />
        </label>
        <small id={countId} className="task-notes-count">
          {t('Символов: {count} из {limit}', { count: value.note.length, limit: 5000 })}
        </small>

        {steps.length > 0 ? (
          <>
            <p role="status">
              {t('Выполнено {done} из {total}', { done: completed.size, total: steps.length })}
            </p>
            <progress
              value={completed.size}
              max={steps.length}
              aria-label={t('Прогресс выполнения')}
            />
            <ul className="task-notes-list">
              {steps.map((step, index) => (
                <li key={`${index}:${step}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={completed.has(index)}
                      onChange={() => toggle(index)}
                    />
                    <span>{step}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t('Этапы не указаны. Вы можете оставить заметку.')}</p>
        )}

        <button type="button" className="button" onClick={onClear}>
          {t('Очистить мои записи')}
        </button>
      </fieldset>
    </section>
  );
}
