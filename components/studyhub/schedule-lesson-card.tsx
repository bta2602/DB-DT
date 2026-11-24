'use client';

import { useId, useState } from 'react';
import type { Lesson } from '@/lib/studyhub/api-contract';
import {
  formatTime,
  lessonKindLabel,
  lessonSchedule,
  lessonStatus,
  statusNames,
} from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { Badge, Icon } from './shared';
import styles from './schedule.module.css';

export function ScheduleLessonCard({
  lesson,
  onEdit,
  now,
}: {
  lesson: Lesson;
  onEdit?: (lesson: Lesson) => void;
  now?: number;
}) {
  const { t } = useI18n();
  const { data, now: snapshotTime } = useStudyHub();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const detailsId = `${id}-details`;
  const subjectId = `${id}-subject`;
  const subject = data.subjects.find((item) => item.id === lesson.subjectId)?.name || '—';
  const status = lessonStatus(lesson, now ?? snapshotTime);
  const schedule = lessonSchedule(lesson, data.lessons);

  return (
    <article className={styles.lesson}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.time}>
          {formatTime(schedule.startsAt)}
          {schedule.endsAt && <small>{formatTime(schedule.endsAt)}</small>}
        </span>
        <span className={styles.subject}>
          <strong id={subjectId}>{subject}</strong>
          <small>{t(lessonKindLabel(lesson.kind))}</small>
        </span>
        <Badge kind={status === 'current' ? '' : status === 'cancelled' ? 'red' : 'neutral'}>
          {t(statusNames[status])}
        </Badge>
        <span className={styles.disclosure}>
          <span>{expanded ? t('Свернуть') : t('Подробнее')}</span>
          <Icon name="down" className="sm" />
        </span>
      </button>
      <div id={detailsId} className={styles.details} hidden={!expanded}>
        <dl aria-labelledby={subjectId}>
          <div>
            <dt>{t('Преподаватель')}</dt>
            <dd>{data.users.find((item) => item.id === lesson.teacherId)?.name || '—'}</dd>
          </div>
          <div>
            <dt>{t('Группа')}</dt>
            <dd>{data.groups.find((item) => item.id === lesson.groupId)?.name || '—'}</dd>
          </div>
          {schedule.roomId && (
            <div>
              <dt>{t('Аудитория')}</dt>
              <dd>{data.rooms.find((item) => item.id === schedule.roomId)?.name || '—'}</dd>
            </div>
          )}
        </dl>
        {onEdit && (
          <button
            type="button"
            className="button small"
            onClick={() => onEdit(lesson)}
            aria-label={t('Изменить занятие: {name}', { name: subject })}
          >
            <Icon name="edit" className="sm" />
            {t('Изменить занятие')}
          </button>
        )}
      </div>
    </article>
  );
}
