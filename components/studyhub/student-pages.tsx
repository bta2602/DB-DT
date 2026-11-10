'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Assignment, Bootstrap, Submission, User } from '@/lib/studyhub/api-contract';
import { allowedSubmissionExtensions, maxSubmissionBytes } from '@/lib/studyhub/api-contract';
import {
  deadlineFilters,
  deadlineFlag,
  deadlineLabels,
  matchesDeadline,
  type DeadlineFilter,
} from '@/lib/studyhub/deadlines';
import {
  average,
  dateKey,
  formatDate,
  formatTime,
  gradeLabel,
  numericGrade,
  lessonStatus,
  lessonDay,
  lessonSortKey,
  lessonKindLabel,
  roles,
  statusNames,
} from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading } from './shared';
import { AnnouncementsPanel } from './publication-panels';
import { useBrowserStorage } from './use-browser-storage';
import { StorageFeedback } from './storage-feedback';
import {
  defaultTaskFilters,
  isStudentTaskFilters,
  normalizeTaskFilters,
  studentFilterLabels,
  taskStatuses,
  type StudentTaskFilters,
} from '@/lib/studyhub/student-task-filters';

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
const assignmentStatus = (submission?: Submission) => submission?.status ?? 'missing';

function AssignmentCards({
  assignments,
  onOpen,
}: {
  assignments: Assignment[];
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const deadlineText = deadlineLabels[locale];
  if (!assignments.length)
    return (
      <EmptyState
        title={t('Заданий пока нет')}
        description={t('Новые задания появятся после публикации преподавателем.')}
      />
    );
  return (
    <div className="assignment-grid">
      {assignments.map((assignment) => {
        const submission = data.submissions.find(
          (item) => item.assignmentId === assignment.id && item.studentId === user?.id,
        );
        const flag = deadlineFlag(assignment.dueAt, assignmentStatus(submission), now);
        return (
          <button
            type="button"
            className="card assignment-card"
            key={assignment.id}
            onClick={() => onOpen(assignment.id)}
          >
            <div className="flex between">
              <Badge
                kind={
                  submission?.status === 'revision'
                    ? 'amber'
                    : submission?.status === 'reviewed'
                      ? ''
                      : 'neutral'
                }
              >
                {t(statusNames[assignmentStatus(submission)])}
              </Badge>
              <small>
                {data.subjects.find((subject) => subject.id === assignment.subjectId)?.name}
              </small>
            </div>
            <h3>{assignment.title}</h3>
            <p>{t(lessonKindLabel(assignment.type))}</p>
            {flag && (
              <Badge kind={flag === 'overdue' ? 'red' : 'amber'}>{deadlineText[flag]}</Badge>
            )}
            <footer>
              {submission?.status === 'reviewed'
                ? t('Оценка {value0} из 100', { value0: String(submission.grade ?? '—') })
                : t('До {value0}, {value1}', {
                    value0: String(formatDate(assignment.dueAt, locale)),
                    value1: String(formatTime(assignment.dueAt)),
                  })}
              <Icon name="arrow" className="sm" />
            </footer>
          </button>
        );
      })}
    </div>
  );
}

function AssignmentDialog({
  assignment,
  onClose,
}: {
  assignment: Assignment;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { data, user, mutate, downloadFile, notify } = useStudyHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const submission = data.submissions.find(
    (item) => item.assignmentId === assignment.id && item.studentId === user?.id,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Выберите непустой файл.');
      return;
    }
    if (file.size > maxSubmissionBytes) {
      setError('Файл больше 3 МБ.');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!allowedSubmissionExtensions.some((allowed) => allowed === extension)) {
      setError('Этот формат не поддерживается.');
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await mutate(
        'POST',
        `/api/assignments/${encodeURIComponent(assignment.id)}/submission`,
        body,
      );
      setFileKey((value) => value + 1);
      notify(t('Работа отправлена.'));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={assignment.title} onClose={onClose}>
      <Badge kind={submission?.status === 'revision' ? 'amber' : ''}>
        {t(statusNames[assignmentStatus(submission)])}
      </Badge>
      <p className="muted mt">
        {data.subjects.find((item) => item.id === assignment.subjectId)?.name} ·{' '}
        {data.groups.find((item) => item.id === assignment.groupId)?.name}
      </p>
      <p className="mt">
        {t('Срок:')} {formatDate(assignment.dueAt, locale)}, {formatTime(assignment.dueAt)}
      </p>
      <section className="drawer-section">
        <h3>{t('Что нужно сделать')}</h3>
        <p className="preserve-lines">{assignment.description}</p>
        {assignment.steps.length > 0 && (
          <ol>
            {assignment.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        )}
      </section>
      {submission && (
        <section className="drawer-section">
          <h3>{t('Отправленная работа')}</h3>
          <button
            type="button"
            className="button"
            onClick={() =>
              void downloadFile(submission.file.id, submission.file.name).catch((failure) =>
                notify(t(messageOf(failure))),
              )
            }
          >
            <Icon name="file" className="sm" />
            {submission.file.name}
          </button>
          <p className="muted small mt">
            {formatDate(submission.submittedAt, locale)}, {formatTime(submission.submittedAt)}
          </p>
        </section>
      )}
      {submission && ['reviewed', 'revision'].includes(submission.status) && (
        <section className="feedback drawer-section">
          <div className="flex between">
            <h3>{t('Обратная связь')}</h3>
            {submission.grade !== null && <span className="grade">{submission.grade}</span>}
          </div>
          <p className="preserve-lines">{submission.comment || t('Без комментария')}</p>
        </section>
      )}
      {submission?.status !== 'reviewed' && (
        <form onSubmit={submit} aria-busy={busy}>
          <Field label={submission ? t('Заменить файл') : t('Ваша работа')}>
            <input
              key={fileKey}
              type="file"
              name="file"
              accept={allowedSubmissionExtensions.map((extension) => `.${extension}`).join(',')}
              required
              disabled={busy}
              aria-describedby="submission-file-hint submission-file-error"
            />
          </Field>
          <p id="submission-file-hint" className="small muted">
            {t('PDF, DOCX, ZIP, SQL, TXT или изображение · до 3 МБ')}{' '}
          </p>
          <p id="submission-file-error" className="form-error error-text" role="alert">
            {t(error)}
          </p>
          <button className="button primary full mt" type="submit" disabled={busy}>
            {busy ? t('Отправляем…') : submission ? t('Отправить повторно') : t('Сдать работу')}
          </button>
        </form>
      )}
    </Modal>
  );
}

export function StudentToday() {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = dateKey(new Date(now));
  const lessons = data.lessons
    .filter(
      (lesson) =>
        lesson.groupId === user?.groupId &&
        lessonDay(lesson) === today &&
        lesson.status !== 'cancelled',
    )
    .sort((a, b) => lessonSortKey(a).localeCompare(lessonSortKey(b)));
  const tasks = data.assignments
    .filter(
      (assignment) =>
        assignment.groupId === user?.groupId &&
        !['submitted', 'reviewed'].includes(
          assignmentStatus(
            data.submissions.find(
              (submission) =>
                submission.assignmentId === assignment.id && submission.studentId === user?.id,
            ),
          ),
        ),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const selected = data.assignments.find((assignment) => assignment.id === selectedId);
  return (
    <>
      <PageHeading
        title={t('С возвращением, {value0}!', {
          value0: String(user?.name.split(' ')[0] || t('студент')),
        })}
        description={formatDate(today, locale)}
      />
      <div className="teacher-stats">
        {[
          [lessons.length, t('Занятий сегодня'), 'calendar'],
          [tasks.length, t('Заданий к выполнению'), 'tasks'],
          [data.subjects.length, t('Учебных предметов'), 'users'],
        ].map(([count, label, icon]) => (
          <div className="teacher-stat" key={String(label)}>
            <span className="stat-icon">
              <Icon name={String(icon)} />
            </span>
            <div>
              <strong>{count}</strong>
              <p>{label}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="main-column">
          <section>
            <div className="section-head">
              <h2>{t('Сегодня на парах')}</h2>
              <Link href="/schedule" className="button small">
                {t('Всё расписание')}{' '}
              </Link>
            </div>
            {lessons.length ? (
              <div className="schedule-list">
                {lessons.map((lesson) => {
                  const status = lessonStatus(lesson, now);
                  return (
                    <div key={lesson.id} className="publication-lesson">
                      <div className="lesson-time">
                        {lesson.kind === 'srsp' ? t('СРСП') : formatTime(lesson.startsAt)}
                        {lesson.endsAt && <small>{formatTime(lesson.endsAt)}</small>}
                      </div>
                      <span className="subject-icon">
                        <Icon name="book" />
                      </span>
                      <div className="grow">
                        <strong>
                          {data.subjects.find((item) => item.id === lesson.subjectId)?.name}
                        </strong>
                        <p>
                          {t(lessonKindLabel(lesson.kind))} ·{' '}
                          {data.users.find((item) => item.id === lesson.teacherId)?.name}
                        </p>
                        <small>
                          {data.groups.find((item) => item.id === lesson.groupId)?.name}{' '}
                          {lesson.roomId && (
                            <>
                              {t('· Ауд.')}{' '}
                              {data.rooms.find((item) => item.id === lesson.roomId)?.name}
                            </>
                          )}
                        </small>
                      </div>
                      <Badge kind={status === 'current' ? '' : 'neutral'}>
                        {t(statusNames[status])}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card">
                <EmptyState
                  title={t('На сегодня занятий нет')}
                  description={t('Опубликованные занятия можно посмотреть в расписании.')}
                />
              </div>
            )}
          </section>
          <section>
            <div className="section-head">
              <h2>{t('Ближайшие задания')}</h2>
              <Link href="/tasks" className="button small">
                {t('Все задания')}{' '}
              </Link>
            </div>
            <AssignmentCards assignments={tasks.slice(0, 3)} onOpen={setSelectedId} />
          </section>
        </div>
        <aside>
          <AnnouncementsPanel />
        </aside>
      </div>
      {selected && (
        <AssignmentDialog
          key={selected.id}
          assignment={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

export function TasksPage() {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const stored = useBrowserStorage({
    userId: user?.id,
    area: 'filters',
    entityId: 'tasks',
    fallback: defaultTaskFilters,
    validate: isStudentTaskFilters,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const labels = studentFilterLabels[locale];
  const deadlineText = deadlineLabels[locale];
  const submissions = new Map(
    data.submissions
      .filter((item) => item.studentId === user?.id)
      .map((item) => [item.assignmentId, item]),
  );
  const ownAssignments = data.assignments.filter((item) => item.groupId === user?.groupId);
  const filters = normalizeTaskFilters(stored.value, ownAssignments);
  const { status, query, deadline, subjectId, type } = filters;
  function changeFilters(patch: Partial<StudentTaskFilters>) {
    stored.setValue({ ...filters, ...patch });
  }
  const subjects = data.subjects.filter((subject) =>
    ownAssignments.some((item) => item.subjectId === subject.id),
  );
  const types = [...new Set(ownAssignments.map((item) => item.type))];
  const overdueCount = ownAssignments.filter((item) =>
    matchesDeadline(item.dueAt, assignmentStatus(submissions.get(item.id)), 'overdue', now),
  ).length;
  const assignments = ownAssignments
    .filter((item) => {
      const workStatus = assignmentStatus(submissions.get(item.id));
      return (
        (status === 'all' || workStatus === status) &&
        (!subjectId || item.subjectId === subjectId) &&
        (!type || item.type === type) &&
        item.title.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)) &&
        matchesDeadline(item.dueAt, workStatus, deadline, now)
      );
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const selected = ownAssignments.find((item) => item.id === selectedId);
  const filtering = Boolean(
    query.trim() || status !== 'all' || deadline !== 'all' || subjectId || type,
  );
  return (
    <>
      <PageHeading
        title={t('Мои задания')}
        description={t('От первого шага до обратной связи преподавателя.')}
      />
      <p className="small muted" role="status">
        {deadlineText.count}: {overdueCount}
      </p>
      <div className="publication-toolbar">
        <Field label={labels.subject}>
          <select
            value={subjectId}
            disabled={!stored.ready}
            onChange={(event) => changeFilters({ subjectId: event.target.value })}
          >
            <option value="">{labels.allSubjects}</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={labels.type}>
          <select
            value={type}
            disabled={!stored.ready}
            onChange={(event) => changeFilters({ type: event.target.value })}
          >
            <option value="">{labels.allTypes}</option>
            {types.map((item) => (
              <option key={item} value={item}>
                {t(lessonKindLabel(item))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={deadlineText.title}>
          <select
            value={deadline}
            disabled={!stored.ready}
            onChange={(event) => changeFilters({ deadline: event.target.value as DeadlineFilter })}
          >
            {deadlineFilters.map((item) => (
              <option key={item} value={item}>
                {deadlineText[item]}
              </option>
            ))}
          </select>
        </Field>
        <div className="tabs" role="group" aria-label={t('Статус задания')}>
          {taskStatuses.map((item) => (
            <button
              type="button"
              key={item}
              className={item === status ? 'active' : ''}
              aria-pressed={item === status}
              disabled={!stored.ready}
              onClick={() => changeFilters({ status: item })}
            >
              {item === 'all' ? t('Все') : t(statusNames[item])}
            </button>
          ))}
        </div>
        <input
          className="select"
          type="search"
          value={query}
          maxLength={500}
          disabled={!stored.ready}
          onChange={(event) => changeFilters({ query: event.target.value })}
          placeholder={t('Найти задание…')}
          aria-label={t('Поиск задания')}
        />
        <button
          className="button"
          type="button"
          disabled={!stored.ready}
          onClick={() => stored.reset()}
        >
          {labels.reset}
        </button>
      </div>
      <p className="small muted" role="status">
        {labels.results}: {assignments.length}
      </p>
      <StorageFeedback status={stored.status} />
      {assignments.length ? (
        <AssignmentCards assignments={assignments} onOpen={setSelectedId} />
      ) : (
        <EmptyState
          title={filtering ? t('Задания не найдены') : t('Заданий пока нет')}
          description={
            filtering ? labels.empty : t('Новые задания появятся после публикации преподавателем.')
          }
        />
      )}
      {selected && (
        <AssignmentDialog
          key={selected.id}
          assignment={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function subjectGrades(data: Bootstrap, studentId: string | undefined, subjectId: string) {
  const lessonGrades = data.grades.flatMap((grade) => {
    const lesson = data.lessons.find(
      (item) => item.id === grade.lessonId && item.subjectId === subjectId,
    );
    return lesson && grade.studentId === studentId && grade.status !== 'unmarked'
      ? [
          {
            id: `lesson-${lesson.id}`,
            title: lessonKindLabel(lesson.kind),
            date: lesson.startsAt || lesson.date,
            grade: numericGrade(grade),
            label: String(gradeLabel(grade)),
            comment: '',
          },
        ]
      : [];
  });
  const workGrades = data.submissions.flatMap((submission) => {
    const assignment = data.assignments.find(
      (item) => item.id === submission.assignmentId && item.subjectId === subjectId,
    );
    return assignment &&
      submission.studentId === studentId &&
      submission.status === 'reviewed' &&
      submission.grade !== null
      ? [
          {
            id: `work-${submission.id}`,
            title: assignment.title,
            date: submission.submittedAt,
            grade: submission.grade,
            label: String(submission.grade),
            comment: submission.comment,
          },
        ]
      : [];
  });
  return [...lessonGrades, ...workGrades].sort((a, b) => b.date.localeCompare(a.date));
}

export function SubjectsPage() {
  const { t, locale } = useI18n();
  const { data, user, downloadFile, notify } = useStudyHub();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'grades' | 'materials'>('grades');
  const subject = data.subjects.find((item) => item.id === selectedId);
  if (!subject)
    return (
      <>
        <PageHeading title={t('Мои предметы')} description={t('Оценки и учебные материалы.')} />
        {data.subjects.length ? (
          <div className="subject-grid">
            {data.subjects.map((item) => {
              const score = average(
                subjectGrades(data, user?.id, item.id).map((grade) => grade.grade),
              );
              return (
                <button
                  type="button"
                  className="card subject-card"
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setTab('grades');
                  }}
                >
                  <span className="subject-icon">
                    <Icon name="book" />
                  </span>
                  <h3>{item.name}</h3>
                  <p>
                    {t('Средний балл:')}{' '}
                    {score === null
                      ? '—'
                      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(score)}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={t('Предметов пока нет')}
            description={t('Они появятся после назначения вашей группе.')}
          />
        )}
      </>
    );
  const grades = subjectGrades(data, user?.id, subject.id);
  const materials = data.materials.filter((item) => item.subjectId === subject.id);
  return (
    <>
      <button type="button" className="button text-link mb" onClick={() => setSelectedId(null)}>
        <Icon name="left" className="sm" />
        {t('Все предметы')}{' '}
      </button>
      <PageHeading title={subject.name} />
      <div className="tabs mb" role="group" aria-label={t('Раздел предмета')}>
        {(
          [
            ['grades', t('Оценки')],
            ['materials', t('Материалы')],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            className={tab === value ? 'active' : ''}
            aria-pressed={tab === value}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'grades' &&
        (grades.length ? (
          <div className="card table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Дата')}</th>
                  <th>{t('Работа / занятие')}</th>
                  <th>{t('Оценка')}</th>
                  <th>{t('Комментарий')}</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((grade) => (
                  <tr key={grade.id}>
                    <td>{formatDate(grade.date, locale)}</td>
                    <td>{grade.title}</td>
                    <td>
                      <span className="grade">{t(grade.label)}</span>
                    </td>
                    <td className="preserve-lines">{grade.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t('Оценок пока нет')}
            description={t('Они появятся после проверки преподавателем.')}
          />
        ))}
      {tab === 'materials' &&
        (materials.length ? (
          <div className="stack">
            {materials.map((material) => (
              <button
                className="button"
                type="button"
                key={material.id}
                onClick={() =>
                  void downloadFile(material.fileId, material.title).catch((failure) =>
                    notify(t(messageOf(failure))),
                  )
                }
              >
                <Icon name="file" />
                {material.title}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t('Материалов пока нет')}
            description={t('Преподаватель добавит их к этому предмету.')}
          />
        ))}
    </>
  );
}

function ProfileForm({ user }: { user: User }) {
  const { t } = useI18n();
  const { data, mutate, notify } = useStudyHub();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = name.trim();
    if (!value || value.length > 120) {
      setError('Введите имя длиной от 1 до 120 символов.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate('PATCH', '/api/profile', { name: value, version: user.version });
      notify(t('Профиль сохранён.'));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card card-pad profile-form" aria-busy={busy}>
      <Field label={t('Имя и фамилия')}>
        <input
          name="name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          autoComplete="name"
        />
      </Field>
      <Field label={t('Электронная почта')}>
        <input type="email" value={user.email} disabled />
      </Field>
      <p className="muted">
        {t(roles[user.role])}
        {user.groupId
          ? ` · ${data.groups.find((item) => item.id === user.groupId)?.name || t('Группа не указана')}`
          : ''}
      </p>
      <p className="form-error error-text" role="alert">
        {t(error)}
      </p>
      <button className="button primary mt" type="submit" disabled={busy}>
        {busy ? t('Сохраняем…') : t('Сохранить')}
      </button>
    </form>
  );
}

export function ProfilePage() {
  const { t } = useI18n();
  const { user } = useStudyHub();
  return (
    <>
      <PageHeading title={t('Мой профиль')} description={t('Данные вашего аккаунта.')} />
      {user && <ProfileForm key={`${user.id}-${user.version}`} user={user} />}
    </>
  );
}
