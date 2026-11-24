'use client';

import { useI18n } from './preferences';

import Link from 'next/link';
import { SearchSelect } from './search-select';
import { SearchField } from './search-field';
import { SortHeading } from './sort-heading';
import { sortRows, nextSort, type SortState } from '@/lib/studyhub/table-sort';
import { LessonEditor } from './lesson-editor';
import { ScheduleLessonCard } from './schedule-lesson-card';
import scheduleStyles from './schedule.module.css';
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
  lessonSchedule,
  lessonDay,
  lessonSortKey,
  lessonKindLabel,
  roles,
  statusNames,
} from '@/lib/studyhub/client-utils';
import { ApiError, useStudyHub } from './context';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading, Person } from './shared';
import { AnnouncementsPanel } from './publication-panels';
import { useBrowserStorage } from './use-browser-storage';
import { StorageFeedback } from './storage-feedback';
import { readUserName, UserNameFields } from './user-name-fields';
import {
  emptyScheduleFilters,
  isScheduleFilters,
  matchesScheduleFilters,
  normalizeScheduleFilters,
  scheduleFilterLabels,
  scheduleScope,
  type ScheduleFilters,
} from '@/lib/studyhub/schedule-filters';

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

function LessonFilters({
  filters,
  onChange,
  scope,
  user,
  full = false,
  disabled = false,
  resetKey = 0,
}: {
  filters: ScheduleFilters;
  onChange: (next: ScheduleFilters) => void;
  scope: ReturnType<typeof scheduleScope>;
  user: User | null;
  full?: boolean;
  disabled?: boolean;
  resetKey?: number;
}) {
  const { t, locale } = useI18n();
  const labels = scheduleFilterLabels[locale];
  const select = (key: keyof ScheduleFilters) => (event: React.ChangeEvent<HTMLSelectElement>) =>
    onChange({ ...filters, [key]: event.target.value });
  return (
    <>
      {user?.role !== 'student' && (
        <SearchSelect
          resetKey={resetKey}
          label={t('Группа')}
          options={scope.groups}
          placeholder={t('Все группы')}
          value={filters.group}
          disabled={disabled}
          onChange={(value) => onChange({ ...filters, group: value })}
        />
      )}
      {user?.role !== 'teacher' && (
        <SearchSelect
          resetKey={resetKey}
          label={t('Преподаватель')}
          options={scope.teachers}
          placeholder={labels.allTeachers}
          value={filters.teacher}
          disabled={disabled}
          onChange={(value) => onChange({ ...filters, teacher: value })}
        />
      )}
      <SearchSelect
        resetKey={resetKey}
        label={t('Предмет')}
        options={scope.subjects}
        placeholder={labels.allSubjects}
        value={filters.subject}
        disabled={disabled}
        onChange={(value) => onChange({ ...filters, subject: value })}
      />
      {full && (
        <>
          <SearchSelect
            resetKey={resetKey}
            label={t('Аудитория')}
            options={scope.rooms}
            placeholder={labels.allRooms}
            value={filters.room}
            disabled={disabled}
            onChange={(value) => onChange({ ...filters, room: value })}
          />
          <Field label={t('Тип занятия')}>
            <select disabled={disabled} value={filters.kind} onChange={select('kind')}>
              <option value="">{labels.allKinds}</option>
              {scope.kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'lecture' || kind === 'practice' || kind === 'srsp'
                    ? labels[kind]
                    : t(kind)}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}

function Table({
  headers,
  children,
  sort,
  onSort,
  actionColumn = true,
}: {
  headers: string[];
  children: ReactNode;
  sort: SortState;
  onSort: (key: string) => void;
  actionColumn?: boolean;
}) {
  return (
    <div className="card table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header, index) =>
              actionColumn && index === headers.length - 1 ? (
                <th key={index} scope="col">
                  {header}
                </th>
              ) : (
                <SortHeading
                  key={index}
                  label={header}
                  column={String(index)}
                  sort={sort}
                  onSort={onSort}
                />
              ),
            )}
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
  compact = false,
}: {
  lessons: Lesson[];
  onEdit?: (lesson: Lesson) => void;
  now?: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { data, now: snapshotTime } = useStudyHub();
  lessons = lessons.filter((lesson) => !lesson.archivedAt);
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
        if (compact) {
          return <ScheduleLessonCard key={lesson.id} lesson={lesson} onEdit={onEdit} now={now} />;
        }
        const status = lessonStatus(lesson, now ?? snapshotTime);
        const schedule = lessonSchedule(lesson, data.lessons);
        return (
          <div className="publication-lesson" key={lesson.id}>
            <div className="lesson-time">
              {lesson.kind === 'srsp' ? t('СРСП') : formatTime(schedule.startsAt)}
              {lesson.kind === 'srsp' && <small>{formatTime(schedule.startsAt)}</small>}
              {schedule.endsAt && <small>{formatTime(schedule.endsAt)}</small>}
            </div>
            <span className="subject-icon">
              <Icon name="book" />
            </span>
            <div className="grow">
              <strong>{referenceName(data.subjects, lesson.subjectId)}</strong>
              <p>
                {t(lessonKindLabel(lesson.kind))} · {referenceName(data.users, lesson.teacherId)}
              </p>
              <small>
                {referenceName(data.groups, lesson.groupId)}{' '}
                {schedule.roomId && (
                  <>
                    {t('· Ауд.')} {referenceName(data.rooms, schedule.roomId)}
                  </>
                )}
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
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
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
        : kind === 'users'
          ? readUserName(fields)
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
    setNameErrors({});
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
      if (failure instanceof ApiError) setNameErrors(failure.fields);
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
            <SearchField
              label={t('Преподаватель')}
              name="teacherId"
              options={teachers}
              placeholder={t('Выберите значение')}
              required
            />
            <SearchField
              label={t('Группа')}
              name="groupId"
              options={data.groups}
              placeholder={t('Выберите значение')}
              required
            />
            <SearchField
              label={t('Предмет')}
              name="subjectId"
              options={data.subjects}
              placeholder={t('Выберите значение')}
              required
            />
          </>
        ) : kind === 'users' ? (
          <UserNameFields user={oldUser} errors={nameErrors} disabled={busy} />
        ) : (
          <Field label={t('Название')}>
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
              <SearchField
                label={t('Группа студента')}
                name="groupId"
                options={data.groups}
                defaultValue={oldUser?.groupId || ''}
                placeholder={t('Без группы')}
              />
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
            <SearchField
              label={t('Куратор')}
              name="curatorId"
              options={teachers}
              defaultValue={oldGroup?.curatorId || ''}
              placeholder={t('Не назначен')}
            />
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

export function AdminOverview() {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const [selection, setSelection] = useState(emptyScheduleFilters);
  const [filterResetKey, setFilterResetKey] = useState(0);
  const scope = scheduleScope(data, user);
  const filters = normalizeScheduleFilters(selection, scope, user);
  const labels = scheduleFilterLabels[locale];
  const filtered = scope.lessons.filter((lesson) =>
    matchesScheduleFilters(lesson, filters, data.lessons),
  );
  const active = filtered
    .filter((lesson) => lessonStatus(lesson, now) === 'current')
    .sort((a, b) => lessonSortKey(a, data.lessons).localeCompare(lessonSortKey(b, data.lessons)));
  const today = dateKey(new Date(now));
  const next = filtered
    .filter((lesson) => lessonStatus(lesson, now) === 'upcoming' && lessonDay(lesson) === today)
    .sort((a, b) => lessonSortKey(a, data.lessons).localeCompare(lessonSortKey(b, data.lessons)));
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
      <div className="control-panel">
        <div className="control-grid">
          <LessonFilters
            filters={filters}
            resetKey={filterResetKey}
            onChange={setSelection}
            scope={scope}
            user={user}
          />
        </div>
        <div className="control-actions">
          <p className="control-status" role="status">
            {labels.results}: {active.length + next.length}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setSelection(emptyScheduleFilters);
              setFilterResetKey((key) => key + 1);
            }}
          >
            {labels.reset}
          </button>
        </div>
      </div>
      <Statistics
        items={[
          [active.length, t('Занятий идут сейчас'), 'calendar'],
          [
            new Set(active.map((lesson) => lesson.teacherId)).size,
            t('Преподавателей на парах'),
            'users',
          ],
          [
            new Set(active.map((lesson) => lesson.roomId).filter(Boolean)).size,
            labels.occupiedRooms,
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
  const [filterResetKey, setFilterResetKey] = useState(0);
  const storage = useBrowserStorage({
    userId: user?.id,
    area: 'filters',
    entityId: 'schedule',
    fallback: emptyScheduleFilters,
    validate: isScheduleFilters,
  });
  const scope = scheduleScope(data, user);
  const filters = normalizeScheduleFilters(storage.value, scope, user);
  const mode = filters.mode;
  const filtered = scope.lessons.filter((lesson) =>
    matchesScheduleFilters(lesson, filters, data.lessons),
  );
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const admin = user?.role === 'admin';
  const labels = scheduleFilterLabels[locale];

  function moveDate(direction: -1 | 1) {
    const selected = new Date(`${date}T12:00:00Z`);
    const step = mode === 'week' ? 7 : 1;
    selected.setUTCDate(selected.getUTCDate() + direction * step);
    setDate(selected.toISOString().slice(0, 10));
  }

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
  const shown = filtered.filter((lesson) => dates.includes(lessonDay(lesson))).length;
  return (
    <div className={scheduleStyles.page}>
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
      <div className={`control-panel ${scheduleStyles.controls}`}>
        <div className="control-actions schedule-controls">
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
          <div className="control-group">
            <button type="button" className="button" onClick={() => moveDate(-1)}>
              <Icon name="arrowLeft" className="sm" />
              {labels.previous}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setDate(dateKey(new Date(now)))}
            >
              {t('Сегодня')}
            </button>
            <button type="button" className="button" onClick={() => moveDate(1)}>
              {labels.next}
              <Icon name="arrow" className="sm" />
            </button>
          </div>
          <div className="tabs" role="group" aria-label={t('Вид расписания')}>
            {(['day', 'week'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={mode === value ? 'active' : ''}
                aria-pressed={mode === value}
                disabled={!storage.ready}
                onClick={() => storage.setValue({ ...filters, mode: value })}
              >
                {value === 'day' ? t('День') : t('Неделя')}
              </button>
            ))}
          </div>
        </div>
        <div className="control-grid">
          <LessonFilters
            filters={filters}
            resetKey={filterResetKey}
            onChange={storage.setValue}
            scope={scope}
            user={user}
            full
            disabled={!storage.ready}
          />
        </div>
        <div className="control-actions">
          <p className="control-status" role="status">
            {labels.results}: {shown}
          </p>
          <button
            type="button"
            className="button"
            disabled={!storage.ready}
            onClick={() => {
              storage.reset();
              setFilterResetKey((key) => key + 1);
            }}
          >
            {labels.reset}
          </button>
        </div>
        <StorageFeedback status={storage.status} />
      </div>
      {admin && <SetupHint onOpen={() => setEditing('new')} />}
      <div className={`${scheduleStyles.days} ${mode === 'week' ? scheduleStyles.week : ''}`}>
        {dates.map((day) => (
          <section key={day}>
            <h2 className="schedule-date-title">{formatDate(day, locale)}</h2>
            <LessonList
              lessons={filtered
                .filter((lesson) => lessonDay(lesson) === day)
                .sort((a, b) =>
                  lessonSortKey(a, data.lessons).localeCompare(lessonSortKey(b, data.lessons)),
                )}
              now={now}
              onEdit={admin ? setEditing : undefined}
              compact
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
    </div>
  );
}

export function RoomsPage() {
  const { t, locale } = useI18n();
  const { data, now, user, ready, error } = useStudyHub();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const [occupancy, setOccupancy] = useState('');
  const [sort, setSort] = useState<SortState>({ key: '0', direction: 'asc' });
  const labels = scheduleFilterLabels[locale];
  // Only the administrator's bootstrap contains the full school timetable.
  const availabilityKnown = user?.role === 'admin' && ready && !error;
  const occupied = new Map(
    data.lessons
      .filter(
        (lesson) => !lesson.archivedAt && lesson.roomId && lessonStatus(lesson, now) === 'current',
      )
      .map((lesson) => [lesson.roomId, lesson]),
  );
  const rooms = data.rooms.filter(
    (room) =>
      !occupancy ||
      (availabilityKnown &&
        (occupancy === 'busy' ? occupied.has(room.id) : !occupied.has(room.id))),
  );
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
      <div className="control-panel">
        <div className="control-grid">
          <Field label={labels.occupancy}>
            <select
              value={occupancy}
              disabled={!availabilityKnown}
              onChange={(event) => setOccupancy(event.target.value)}
            >
              <option value="">{labels.allOccupancy}</option>
              <option value="free">{t('Свободна')}</option>
              <option value="busy">{labels.busy}</option>
            </select>
          </Field>
        </div>
        <div className="control-actions">
          <p className="control-status" role="status">
            {labels.found}: {rooms.length}
          </p>
          <button type="button" className="button" onClick={() => setOccupancy('')}>
            {labels.reset}
          </button>
        </div>
      </div>
      {rooms.length ? (
        <Table
          sort={sort}
          onSort={(key) => setSort(nextSort(sort, key))}
          headers={[t('Аудитория'), t('Вместимость'), t('Сейчас'), t('Действие')]}
        >
          {sortRows(
            rooms,
            sort,
            (room, key) =>
              key === '1'
                ? room.capacity
                : key === '2'
                  ? availabilityKnown
                    ? Number(occupied.has(room.id))
                    : null
                  : room.name,
            locale,
          ).map((room) => {
            const lesson = occupied.get(room.id);
            return (
              <tr key={room.id}>
                <td>
                  <strong>{room.name}</strong>
                </td>
                <td>{room.capacity ?? '—'}</td>
                <td>
                  {!availabilityKnown ? (
                    '—'
                  ) : lesson ? (
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
          title={data.rooms.length ? t('Ничего не найдено') : t('Аудитории ещё не добавлены')}
          description={
            data.rooms.length
              ? t('Измените поисковый запрос или фильтры.')
              : t('Добавьте помещения, чтобы составить расписание.')
          }
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
  const [filterResetKey, setFilterResetKey] = useState(0);
  const [role, setRole] = useState('');
  const [group, setGroup] = useState('');
  const [course, setCourse] = useState('');
  const [teacherSubject, setTeacherSubject] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: '0', direction: 'asc' });
  const changeSort = (key: string) => {
    setSort(nextSort(sort, key));
    setPage(0);
  };
  const labels = scheduleFilterLabels[locale];
  const courses = [...new Set(data.groups.map((item) => item.course))].sort((a, b) => a - b);
  const search = query.trim().toLocaleLowerCase(locale);
  const matches = (...values: string[]) =>
    values.join(' ').toLocaleLowerCase(locale).includes(search);
  const filtered = {
    users: data.users.filter(
      (user) =>
        (!role || user.role === role) &&
        (!group || user.groupId === group) &&
        (!teacherSubject ||
          data.teachingAssignments.some(
            (item) => item.teacherId === user.id && item.subjectId === teacherSubject,
          )) &&
        matches(user.name, user.email || '', referenceName(data.groups, user.groupId)),
    ),
    groups: data.groups.filter(
      (item) => (!course || String(item.course) === course) && matches(item.name),
    ),
    subjects: data.subjects.filter((item) => matches(item.name)),
    teachingAssignments: data.teachingAssignments.filter((item) =>
      matches(
        referenceName(data.users, item.teacherId),
        referenceName(data.groups, item.groupId),
        referenceName(data.subjects, item.subjectId),
      ),
    ),
  };
  const sorted = {
    users: sortRows(
      filtered.users,
      sort,
      (item, key) => (key === '1' ? item.email : key === '2' ? t(roles[item.role]) : item.name),
      locale,
    ),
    groups: sortRows(
      filtered.groups,
      sort,
      (item, key) =>
        key === '1'
          ? item.course
          : key === '2'
            ? item.curatorId
              ? referenceName(data.users, item.curatorId)
              : null
            : item.name,
      locale,
    ),
    subjects: sortRows(filtered.subjects, sort, (item) => item.name, locale),
    teachingAssignments: sortRows(
      filtered.teachingAssignments,
      sort,
      (item, key) =>
        key === '1'
          ? referenceName(data.groups, item.groupId)
          : key === '2'
            ? referenceName(data.subjects, item.subjectId)
            : referenceName(data.users, item.teacherId),
      locale,
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
      <div className="tabs mb directory-tabs" role="group" aria-label={t('Справочники')}>
        {Object.entries(tabs).map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'active' : ''}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value as typeof tab);
              setSort({ key: '0', direction: 'asc' });
              setQuery('');
              setPage(0);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="control-panel">
        <div className="control-grid">
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
                    setTeacherSubject('');
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
              <SearchSelect
                resetKey={filterResetKey}
                label={t('Учебная группа')}
                options={data.groups}
                value={group}
                placeholder={t('Все группы')}
                onChange={(value) => {
                  setGroup(value);
                  setRole(value ? 'student' : role);
                  setTeacherSubject('');
                  setPage(0);
                }}
              />
              {role === 'teacher' && (
                <SearchSelect
                  resetKey={filterResetKey}
                  label={t('Предмет')}
                  options={data.subjects}
                  value={teacherSubject}
                  placeholder={labels.allSubjects}
                  onChange={(value) => {
                    setTeacherSubject(value);
                    setPage(0);
                  }}
                />
              )}
            </>
          )}
          {tab === 'groups' && (
            <Field label={t('Курс')}>
              <select
                value={course}
                onChange={(event) => {
                  setCourse(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">{labels.allCourses}</option>
                {courses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="control-actions">
          <p className="control-status" role="status">
            {labels.found}: {count}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setQuery('');
              setRole('');
              setGroup('');
              setTeacherSubject('');
              setCourse('');
              setPage(0);
              setFilterResetKey((key) => key + 1);
            }}
          >
            {labels.reset}
          </button>
        </div>
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
        <Table
          headers={headers[tab]}
          sort={sort}
          onSort={changeSort}
          actionColumn={tab !== 'teachingAssignments'}
        >
          {tab === 'users' &&
            sorted.users.slice(start, start + pageSize).map((user) => (
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
            sorted.groups.slice(start, start + pageSize).map((group) => (
              <tr key={group.id}>
                <td>{group.name}</td>
                <td>{group.course}</td>
                <td>{group.curatorId ? referenceName(data.users, group.curatorId) : '—'}</td>
                <td>{editButton('groups', group)}</td>
              </tr>
            ))}
          {tab === 'subjects' &&
            sorted.subjects.slice(start, start + pageSize).map((subject) => (
              <tr key={subject.id}>
                <td>{subject.name}</td>
                <td>{editButton('subjects', subject)}</td>
              </tr>
            ))}
          {tab === 'teachingAssignments' &&
            sorted.teachingAssignments.slice(start, start + pageSize).map((assignment) => (
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
