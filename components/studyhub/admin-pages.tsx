'use client';

import { useI18n } from './preferences';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import type {
  Bootstrap,
  Group,
  Lesson,
  Role,
  Room,
  Subject,
  User,
} from '@/lib/studyhub/api-contract';
import {
  dateKey,
  formatDate,
  formatTime,
  lessonStatus,
  roles,
  statusNames,
} from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading, Person } from './shared';
import { AnnouncementsPanel } from './publication-panels';

type DirectoryKind = 'users' | 'groups' | 'subjects' | 'rooms' | 'teachingAssignments';
type DirectoryItem = User | Group | Subject | Room;
type Editor = { kind: DirectoryKind; item?: DirectoryItem };
const directoryTitles: Record<DirectoryKind, [string, string]> = {
  users: ['Добавить пользователя', 'Изменить пользователя'],
  groups: ['Добавить группу', 'Изменить группу'],
  subjects: ['Добавить предмет', 'Изменить предмет'],
  rooms: ['Добавить аудиторию', 'Изменить аудиторию'],
  teachingAssignments: ['Добавить назначение', 'Изменить назначение'],
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить изменения.';
const referenceName = (items: { id: string; name: string }[], id: string | null) =>
  items.find((item) => item.id === id)?.name || '—';

function SelectOptions({
  items,
  blank,
}: {
  items: { id: string; name: string }[];
  blank?: string;
}) {
  return (
    <>
      {blank && <option value="">{blank}</option>}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="card table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Statistics({ items }: { items: [number, string, string][] }) {
  const { t } = useI18n();
  return (
    <div className="teacher-stats">
      {items.map(([value, label, icon]) => (
        <div className="teacher-stat" key={t(label)}>
          <span className="stat-icon">
            <Icon name={icon} />
          </span>
          <div>
            <strong>{value}</strong>
            <p>{t(label)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LessonList({
  lessons,
  onEdit,
  now,
}: {
  lessons: Lesson[];
  onEdit?: (lesson: Lesson) => void;
  now?: number;
}) {
  const { t } = useI18n();
  const { data, now: snapshotTime } = useStudyHub();
  if (!lessons.length)
    return (
      <div className="card">
        <EmptyState
          title={t('Занятий пока нет')}
          description={t('Здесь появится опубликованное расписание.')}
        />
      </div>
    );
  return (
    <div className="schedule-list">
      {lessons.map((lesson) => {
        const status = lessonStatus(lesson, now ?? snapshotTime);
        return (
          <div className="publication-lesson" key={lesson.id}>
            <div className="lesson-time">
              {formatTime(lesson.startsAt)}
              <small>{formatTime(lesson.endsAt)}</small>
            </div>
            <span className="subject-icon">
              <Icon name="book" />
            </span>
            <div className="grow">
              <strong>{referenceName(data.subjects, lesson.subjectId)}</strong>
              <p>
                {lesson.kind} · {referenceName(data.users, lesson.teacherId)}
              </p>
              <small>
                {referenceName(data.groups, lesson.groupId)} {t('· Ауд.')}{' '}
                {referenceName(data.rooms, lesson.roomId)}
              </small>
            </div>
            <Badge kind={status === 'current' ? '' : status === 'cancelled' ? 'red' : 'neutral'}>
              {t(statusNames[status])}
            </Badge>
            {onEdit && (
              <button
                type="button"
                className="button small"
                onClick={() => onEdit(lesson)}
                aria-label={t('Изменить занятие: {name}', {
                  name: referenceName(data.subjects, lesson.subjectId),
                })}
              >
                <Icon name="edit" className="sm" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function missingReferences(data: Bootstrap) {
  return [
    {
      kind: 'groups' as const,
      label: 'Группа',
      action: 'Добавить группу',
      ready: data.groups.length > 0,
    },
    {
      kind: 'subjects' as const,
      label: 'Предмет',
      action: 'Добавить предмет',
      ready: data.subjects.length > 0,
    },
    {
      kind: 'users' as const,
      label: 'Преподаватель',
      action: 'Добавить преподавателя',
      ready: data.users.some((user) => user.role === 'teacher'),
    },
    {
      kind: 'rooms' as const,
      label: 'Аудитория',
      action: 'Добавить аудиторию',
      ready: data.rooms.length > 0,
    },
  ].filter((item) => !item.ready);
}

function SetupHint({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { data } = useStudyHub();
  const missing = missingReferences(data);
  if (!missing.length) return null;
  return (
    <section className="lesson-setup-hint" aria-label={t('Подготовка расписания')}>
      <div>
        <strong>{t('Подготовьте первое занятие')}</strong>
        <p>
          {t('Добавьте недостающие данные:')}{' '}
          {missing.map((item) => t(item.label).toLocaleLowerCase()).join(', ')}.
        </p>
      </div>
      <button type="button" className="button small" onClick={onOpen}>
        {t('Заполнить справочники')}
      </button>
    </section>
  );
}

function DirectoryEditor({
  kind,
  item,
  onClose,
  onSaved,
  forLesson = false,
}: Editor & { onClose: () => void; onSaved?: () => void; forLesson?: boolean }) {
  const { t } = useI18n();
  const { data, mutate, notify } = useStudyHub();
  const oldUser = kind === 'users' ? (item as User | undefined) : undefined;
  const oldGroup = kind === 'groups' ? (item as Group | undefined) : undefined;
  const oldRoom = kind === 'rooms' ? (item as Room | undefined) : undefined;
  const [role, setRole] = useState<Role>(oldUser?.role || (forLesson ? 'teacher' : 'student'));
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const teachers = data.users.filter((user) => user.role === 'teacher');
  const incompleteAssignment =
    kind === 'teachingAssignments' &&
    (!teachers.length || !data.groups.length || !data.subjects.length);
  const close = () => {
    if (!busy) onClose();
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || incompleteAssignment) return;
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || '').trim();
    const body: Record<string, unknown> =
      kind === 'teachingAssignments'
        ? {
            teacherId: value('teacherId'),
            groupId: value('groupId'),
            subjectId: value('subjectId'),
          }
        : { name: value('name') };
    if (kind === 'users') {
      Object.assign(body, {
        email: value('email'),
        role,
        groupId: role === 'student' ? value('groupId') || null : null,
      });
      if (!item) body.password = String(fields.get('password') || '');
    }
    if (kind === 'groups')
      Object.assign(body, {
        course: Number(value('course')),
        curatorId: value('curatorId') || null,
      });
    if (kind === 'rooms') body.capacity = value('capacity') ? Number(value('capacity')) : null;
    if (item) body.version = item.version;
    setBusy(true);
    setError('');
    try {
      const path = kind === 'teachingAssignments' ? 'teaching-assignments' : kind;
      await mutate(
        kind === 'teachingAssignments' ? 'PUT' : item ? 'PATCH' : 'POST',
        `/api/${path}${item ? `/${encodeURIComponent(item.id)}` : ''}`,
        body,
      );
      notify(t('Запись сохранена.'));
      if (onSaved) onSaved();
      else onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(
        forLesson && kind === 'users'
          ? item
            ? 'Изменить преподавателя'
            : 'Добавить преподавателя'
          : directoryTitles[kind][item ? 1 : 0],
      )}
      onClose={close}
    >
      <form onSubmit={save} aria-busy={busy}>
        {kind === 'teachingAssignments' ? (
          <>
            {incompleteAssignment && (
              <p className="publication-hint">
                {t('Сначала добавьте преподавателя, группу и предмет в соседних вкладках.')}
              </p>
            )}
            <Field label={t('Преподаватель')}>
              <select name="teacherId" required>
                <SelectOptions items={teachers} />
              </select>
            </Field>
            <Field label={t('Группа')}>
              <select name="groupId" required>
                <SelectOptions items={data.groups} />
              </select>
            </Field>
            <Field label={t('Предмет')}>
              <select name="subjectId" required>
                <SelectOptions items={data.subjects} />
              </select>
            </Field>
          </>
        ) : (
          <Field label={kind === 'users' ? t('Имя и фамилия') : t('Название')}>
            <input name="name" required maxLength={120} defaultValue={item?.name || ''} />
          </Field>
        )}
        {kind === 'users' && (
          <>
            <Field label={t('Почта')}>
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                defaultValue={oldUser?.email || ''}
                autoComplete="off"
              />
            </Field>
            <Field label={t('Роль')}>
              <select
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {Object.entries(roles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            {role === 'student' && (
              <Field label={t('Группа студента')}>
                <select name="groupId" defaultValue={oldUser?.groupId || ''}>
                  <SelectOptions items={data.groups} blank={t('Без группы')} />
                </select>
              </Field>
            )}
            {!item && (
              <div className="field">
                <label htmlFor="new-user-password">{t('Пароль для входа')}</label>
                <div className="auth-password-control">
                  <input
                    id="new-user-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    aria-describedby="new-user-password-hint"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    aria-pressed={showPassword}
                    aria-controls="new-user-password"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? t('Скрыть') : t('Показать')}
                  </button>
                </div>
                <small id="new-user-password-hint" className="auth-field-hint">
                  {t('От 12 до 128 символов. Сообщите пользователю почту и пароль для входа.')}
                </small>
              </div>
            )}
          </>
        )}
        {kind === 'groups' && (
          <>
            <Field label={t('Курс')}>
              <input
                name="course"
                type="number"
                min={1}
                max={6}
                required
                defaultValue={oldGroup?.course || 1}
              />
            </Field>
            <Field label={t('Куратор')}>
              <select name="curatorId" defaultValue={oldGroup?.curatorId || ''}>
                <SelectOptions items={teachers} blank={t('Не назначен')} />
              </select>
            </Field>
          </>
        )}
        {kind === 'rooms' && (
          <Field label={t('Вместимость')}>
            <input
              name="capacity"
              type="number"
              min={1}
              max={1000}
              defaultValue={oldRoom?.capacity ?? ''}
            />
          </Field>
        )}
        <p className="form-error error-text" role="alert">
          {t(error)}
        </p>
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={close}>
            {forLesson ? t('Назад') : t('Отмена')}
          </button>
          <button type="submit" className="button primary" disabled={busy || incompleteAssignment}>
            {busy ? t('Сохраняем…') : t('Сохранить')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LessonEditor({
  lesson,
  initialDate,
  onClose,
}: {
  lesson?: Lesson;
  initialDate?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data, mutate, notify, now } = useStudyHub();
  const [setup, setSetup] = useState<DirectoryKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const missing = missingReferences(data);
  const close = () => {
    if (!busy) onClose();
  };
  if (setup)
    return (
      <DirectoryEditor
        kind={setup}
        forLesson
        onClose={() => setSetup(null)}
        onSaved={() => setSetup(null)}
      />
    );
  if (missing.length)
    return (
      <Modal title={t('Подготовка первого занятия')} onClose={close}>
        <p className="muted">
          {t(
            'Для расписания нужны группа, предмет, преподаватель и аудитория. Добавьте недостающие записи — затем откроется форма занятия.',
          )}
        </p>
        <ul className="lesson-setup-list">
          {missing.map((item) => (
            <li key={item.kind}>
              <span>{t(item.label)}</span>
              <button type="button" className="button small" onClick={() => setSetup(item.kind)}>
                {t(item.action)}
              </button>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button type="button" className="button" onClick={close}>
            {t('Закрыть')}
          </button>
        </div>
      </Modal>
    );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || '').trim();
    setError('');
    setBusy(true);
    try {
      const startsAt = new Date(`${value('date')}T${value('start')}:00+05:00`).toISOString();
      const endsAt = new Date(`${value('date')}T${value('end')}:00+05:00`).toISOString();
      if (endsAt <= startsAt) throw new Error(t('Время окончания должно быть позже начала.'));
      const body = {
        subjectId: value('subjectId'),
        groupId: value('groupId'),
        teacherId: value('teacherId'),
        roomId: value('roomId'),
        startsAt,
        endsAt,
        kind: value('kind'),
        note: value('note'),
        status: lesson?.status || 'scheduled',
        ...(lesson ? { version: lesson.version } : {}),
      };
      if (
        body.status !== 'cancelled' &&
        data.lessons.some(
          (other) =>
            other.id !== lesson?.id &&
            other.status !== 'cancelled' &&
            other.startsAt < endsAt &&
            startsAt < other.endsAt &&
            (other.groupId === body.groupId ||
              other.teacherId === body.teacherId ||
              other.roomId === body.roomId),
        )
      ) {
        throw new Error(t('Группа, преподаватель или аудитория уже заняты в это время.'));
      }
      await mutate(
        lesson ? 'PATCH' : 'POST',
        `/api/lessons${lesson ? `/${encodeURIComponent(lesson.id)}` : ''}`,
        body,
      );
      notify(t('Занятие сохранено.'));
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!lesson || busy) return;
    setError('');
    setBusy(true);
    try {
      await mutate('PATCH', `/api/lessons/${encodeURIComponent(lesson.id)}`, {
        status: lesson.status === 'cancelled' ? 'scheduled' : 'cancelled',
        version: lesson.version,
      });
      notify(t('Занятие обновлено.'));
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={lesson ? t('Изменить занятие') : t('Новое занятие')} onClose={close}>
      <form onSubmit={save} aria-busy={busy}>
        <div className="form-row">
          <Field label={t('Предмет')}>
            <select name="subjectId" required defaultValue={lesson?.subjectId}>
              <SelectOptions items={data.subjects} />
            </select>
          </Field>
          <Field label={t('Группа')}>
            <select name="groupId" required defaultValue={lesson?.groupId}>
              <SelectOptions items={data.groups} />
            </select>
          </Field>
        </div>
        <Field label={t('Преподаватель')}>
          <select name="teacherId" required defaultValue={lesson?.teacherId}>
            <SelectOptions items={data.users.filter((user) => user.role === 'teacher')} />
          </select>
        </Field>
        <div className="form-row">
          <Field label={t('Аудитория')}>
            <select name="roomId" required defaultValue={lesson?.roomId}>
              <SelectOptions items={data.rooms} />
            </select>
          </Field>
          <Field label={t('Дата')}>
            <input
              name="date"
              type="date"
              required
              defaultValue={
                lesson ? dateKey(lesson.startsAt) : initialDate || dateKey(new Date(now))
              }
            />
          </Field>
        </div>
        <div className="form-row">
          <Field label={t('Начало')}>
            <input
              name="start"
              type="time"
              required
              defaultValue={lesson ? formatTime(lesson.startsAt) : '09:00'}
            />
          </Field>
          <Field label={t('Окончание')}>
            <input
              name="end"
              type="time"
              required
              defaultValue={lesson ? formatTime(lesson.endsAt) : '10:20'}
            />
          </Field>
        </div>
        <Field label={t('Тип занятия')}>
          <input
            name="kind"
            required
            maxLength={60}
            defaultValue={lesson?.kind || ''}
            placeholder={t('Лекция, практика…')}
          />
        </Field>
        <Field label={t('Примечание')}>
          <textarea name="note" maxLength={1000} defaultValue={lesson?.note || ''} />
        </Field>
        <p className="form-error error-text" role="alert">
          {t(error)}
        </p>
        <div className="form-actions">
          {lesson && (
            <button type="button" className="button danger" disabled={busy} onClick={toggle}>
              {lesson.status === 'cancelled' ? t('Восстановить занятие') : t('Отменить занятие')}
            </button>
          )}
          <button type="button" className="button" disabled={busy} onClick={close}>
            {t('Закрыть')}
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? t('Сохраняем…') : t('Сохранить')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminOverview() {
  const { t, locale } = useI18n();
  const { data, now } = useStudyHub();
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const active = data.lessons
    .filter((lesson) => lessonStatus(lesson, now) === 'current')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const today = dateKey(new Date(now));
  const next = data.lessons
    .filter(
      (lesson) => lessonStatus(lesson, now) === 'upcoming' && dateKey(lesson.startsAt) === today,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <>
      <PageHeading
        title={t('Учебный день под контролем.')}
        description={t('Кто сейчас на занятии, в какой группе и аудитории.')}
        action={
          <button type="button" className="button primary" onClick={() => setEditing('new')}>
            <Icon name="plus" className="sm" />
            {t('Добавить занятие')}
          </button>
        }
      />
      <SetupHint onOpen={() => setEditing('new')} />
      <Statistics
        items={[
          [active.length, t('Занятий идут сейчас'), 'calendar'],
          [
            new Set(active.map((lesson) => lesson.teacherId)).size,
            t('Преподавателей на парах'),
            'users',
          ],
          [
            Math.max(0, data.rooms.length - new Set(active.map((lesson) => lesson.roomId)).size),
            t('Свободных аудиторий'),
            'building',
          ],
        ]}
      />
      <section>
        <div className="section-head">
          <h2>{t('Сейчас на занятиях')}</h2>
          <span className="live-clock">
            {formatTime(new Date(now).toISOString())} ·{' '}
            {formatDate(new Date(now).toISOString(), locale)}
          </span>
        </div>
        <LessonList lessons={active} now={now} onEdit={setEditing} />
      </section>
      <section className="mt">
        <div className="section-head">
          <h2>{t('Следующие занятия')}</h2>
          <Link href="/schedule" className="button small">
            {t('Расписание')}
          </Link>
        </div>
        <LessonList lessons={next.slice(0, 6)} now={now} onEdit={setEditing} />
      </section>
      <AnnouncementsPanel />
      {editing && (
        <LessonEditor
          lesson={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function SchedulePage() {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const [date, setDate] = useState(() => dateKey(new Date(now)));
  const [group, setGroup] = useState('');
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const admin = user?.role === 'admin';
  const first = new Date(`${date}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const dates =
    mode === 'day'
      ? [date]
      : Array.from({ length: 7 }, (_, index) => {
          const day = new Date(first);
          day.setUTCDate(day.getUTCDate() + index);
          return day.toISOString().slice(0, 10);
        });
  return (
    <>
      <PageHeading
        title={t('Расписание')}
        description={t('Занятия, преподаватели и аудитории.')}
        action={
          admin && (
            <button type="button" className="button primary" onClick={() => setEditing('new')}>
              <Icon name="plus" className="sm" />
              {t('Добавить занятие')}
            </button>
          )
        }
      />
      <div className="publication-toolbar">
        <Field label={t('Дата')}>
          <input
            type="date"
            required
            value={date}
            onChange={(event) => {
              if (event.target.value) setDate(event.target.value);
            }}
          />
        </Field>
        <Field label={t('Группа')}>
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <SelectOptions items={data.groups} blank={t('Все группы')} />
          </select>
        </Field>
        <div className="tabs" aria-label={t('Вид расписания')}>
          {(['day', 'week'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={mode === value ? 'active' : ''}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === 'day' ? t('День') : t('Неделя')}
            </button>
          ))}
        </div>
        <button type="button" className="button" onClick={() => setDate(dateKey(new Date(now)))}>
          {t('Сегодня')}
        </button>
      </div>
      {admin && <SetupHint onOpen={() => setEditing('new')} />}
      <div className={mode === 'week' ? 'publication-week' : ''}>
        {dates.map((day) => (
          <section key={day}>
            <h2 className="schedule-date-title">{formatDate(day, locale)}</h2>
            <LessonList
              lessons={data.lessons
                .filter(
                  (lesson) =>
                    dateKey(lesson.startsAt) === day && (!group || lesson.groupId === group),
                )
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt))}
              now={now}
              onEdit={admin ? setEditing : undefined}
            />
          </section>
        ))}
      </div>
      {admin && editing && (
        <LessonEditor
          lesson={editing === 'new' ? undefined : editing}
          initialDate={date}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function RoomsPage() {
  const { t } = useI18n();
  const { data, now } = useStudyHub();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  return (
    <>
      <PageHeading
        title={t('Аудитории')}
        description={t('Занятость помещений в текущий момент.')}
        action={
          <button type="button" className="button primary" onClick={() => setEditing('new')}>
            <Icon name="plus" className="sm" />
            {t('Добавить аудиторию')}
          </button>
        }
      />
      {data.rooms.length ? (
        <Table headers={[t('Аудитория'), t('Вместимость'), t('Сейчас'), t('Действие')]}>
          {data.rooms.map((room) => {
            const lesson = data.lessons.find(
              (lesson) => lesson.roomId === room.id && lessonStatus(lesson, now) === 'current',
            );
            return (
              <tr key={room.id}>
                <td>
                  <strong>{room.name}</strong>
                </td>
                <td>{room.capacity ?? '—'}</td>
                <td>
                  {lesson ? (
                    <>
                      {referenceName(data.subjects, lesson.subjectId)}
                      <br />
                      <span className="muted">
                        {referenceName(data.groups, lesson.groupId)} {t('· до')}{' '}
                        {formatTime(lesson.endsAt)}
                      </span>
                    </>
                  ) : (
                    <Badge>{t('Свободна')}</Badge>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setEditing(room)}
                    aria-label={t('Изменить аудиторию: {name}', { name: room.name })}
                  >
                    {t('Изменить')}
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <EmptyState
          title={t('Аудитории ещё не добавлены')}
          description={t('Добавьте помещения, чтобы составить расписание.')}
        />
      )}
      {editing && (
        <DirectoryEditor
          kind="rooms"
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function PeoplePage() {
  const { t, locale } = useI18n();
  const { data } = useStudyHub();
  const [tab, setTab] = useState<Exclude<DirectoryKind, 'rooms'>>('users');
  const [editing, setEditing] = useState<Editor | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(0);
  const search = query.trim().toLocaleLowerCase(locale);
  const matches = (...values: string[]) =>
    values.join(' ').toLocaleLowerCase(locale).includes(search);
  const filtered = {
    users: data.users.filter(
      (user) =>
        (!role || user.role === role) &&
        (!group || user.groupId === group) &&
        matches(user.name, user.email || '', referenceName(data.groups, user.groupId)),
    ),
    groups: data.groups.filter((item) => matches(item.name)),
    subjects: data.subjects.filter((item) => matches(item.name)),
    teachingAssignments: data.teachingAssignments.filter((item) =>
      matches(
        referenceName(data.users, item.teacherId),
        referenceName(data.groups, item.groupId),
        referenceName(data.subjects, item.subjectId),
      ),
    ),
  };
  const pageSize = 25;
  const count = filtered[tab].length;
  const lastPage = Math.max(0, Math.ceil(count / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const tabs = {
    users: t('Пользователи'),
    groups: t('Группы'),
    subjects: t('Предметы'),
    teachingAssignments: t('Назначения'),
  };
  const headers = {
    users: [t('Пользователь'), t('Почта'), t('Роль'), t('Действие')],
    groups: [t('Группа'), t('Курс'), t('Куратор'), t('Действие')],
    subjects: [t('Предмет'), t('Действие')],
    teachingAssignments: [t('Преподаватель'), t('Группа'), t('Предмет')],
  };
  const editButton = (kind: DirectoryKind, item: DirectoryItem) => (
    <button
      type="button"
      className="button small"
      onClick={() => setEditing({ kind, item })}
      aria-label={t('Изменить: {name}', { name: item.name })}
    >
      {t('Изменить')}
    </button>
  );
  return (
    <>
      <PageHeading
        title={t('Пользователи и группы')}
        description={t('Справочники учебного пространства.')}
        action={
          <button
            type="button"
            className="button primary"
            onClick={() => setEditing({ kind: tab })}
          >
            <Icon name="plus" className="sm" />
            {t('Добавить')}
          </button>
        }
      />
      <Statistics
        items={[
          [data.users.filter((user) => user.role === 'student').length, t('Студентов'), 'users'],
          [
            data.users.filter((user) => user.role === 'teacher').length,
            t('Преподавателей'),
            'book',
          ],
          [data.groups.length, t('Учебных групп'), 'building'],
        ]}
      />
      <div className="tabs mb" aria-label={t('Справочники')}>
        {Object.entries(tabs).map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'active' : ''}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value as typeof tab);
              setQuery('');
              setPage(0);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="directory-filters">
        <Field label={t('Поиск по справочнику')}>
          <input
            type="search"
            value={query}
            placeholder={tab === 'users' ? t('Имя, почта или группа') : t('Название или имя')}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </Field>
        {tab === 'users' && (
          <>
            <Field label={t('Роль пользователя')}>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value);
                  setGroup('');
                  setPage(0);
                }}
              >
                <option value="">{t('Все роли')}</option>
                {Object.entries(roles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Учебная группа')}>
              <select
                value={group}
                onChange={(event) => {
                  setGroup(event.target.value);
                  setRole(event.target.value ? 'student' : role);
                  setPage(0);
                }}
              >
                <SelectOptions items={data.groups} blank={t('Все группы')} />
              </select>
            </Field>
          </>
        )}
      </div>
      {!count ? (
        <EmptyState
          title={data[tab].length ? t('Ничего не найдено') : t('Пока пусто')}
          description={
            data[tab].length
              ? t('Измените поисковый запрос или фильтры.')
              : t('Добавьте первую запись с помощью кнопки выше.')
          }
        />
      ) : (
        <Table headers={headers[tab]}>
          {tab === 'users' &&
            filtered.users.slice(start, start + pageSize).map((user) => (
              <tr key={user.id}>
                <td>
                  <Person user={user} />
                </td>
                <td>{user.email}</td>
                <td>{t(roles[user.role])}</td>
                <td>{editButton('users', user)}</td>
              </tr>
            ))}
          {tab === 'groups' &&
            filtered.groups.slice(start, start + pageSize).map((group) => (
              <tr key={group.id}>
                <td>{group.name}</td>
                <td>{group.course}</td>
                <td>{group.curatorId ? referenceName(data.users, group.curatorId) : '—'}</td>
                <td>{editButton('groups', group)}</td>
              </tr>
            ))}
          {tab === 'subjects' &&
            filtered.subjects.slice(start, start + pageSize).map((subject) => (
              <tr key={subject.id}>
                <td>{subject.name}</td>
                <td>{editButton('subjects', subject)}</td>
              </tr>
            ))}
          {tab === 'teachingAssignments' &&
            filtered.teachingAssignments.slice(start, start + pageSize).map((assignment) => (
              <tr key={`${assignment.teacherId}:${assignment.groupId}:${assignment.subjectId}`}>
                <td>{referenceName(data.users, assignment.teacherId)}</td>
                <td>{referenceName(data.groups, assignment.groupId)}</td>
                <td>{referenceName(data.subjects, assignment.subjectId)}</td>
              </tr>
            ))}
        </Table>
      )}
      {count > 0 && (
        <nav className="directory-pagination" aria-label={t('Страницы справочника')}>
          <span className="muted" role="status">
            {t('Записи {start}–{end} из {count}', {
              start: start + 1,
              end: Math.min(start + pageSize, count),
              count,
            })}
          </span>
          <div>
            <button
              type="button"
              className="button small"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t('Назад')}
            </button>
            <span>
              {t('Страница {page} из {total}', { page: currentPage + 1, total: lastPage + 1 })}
            </span>
            <button
              type="button"
              className="button small"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('Далее')}
            </button>
          </div>
        </nav>
      )}
      {editing && <DirectoryEditor {...editing} onClose={() => setEditing(null)} />}
    </>
  );
}
