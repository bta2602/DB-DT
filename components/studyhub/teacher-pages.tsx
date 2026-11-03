'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Assignment,
  Grade,
  GradeStatus,
  Bootstrap,
  Lesson,
  StoredFile,
  Submission,
  User,
} from '@/lib/studyhub/api-contract';
import {
  average,
  dateKey,
  formatDate,
  formatTime,
  gradeLabel,
  numericGrade,
  lessonStatus,
} from '@/lib/studyhub/client-utils';
import { ApiError, useStudyHub } from './context';
import { useI18n } from './preferences';
import { useTeacherDrafts, type ReviewDraft } from './teacher-context';
import { AnnouncementsPanel, MaterialsPanel } from './publication-panels';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading, Person } from './shared';

const workLabels = {
  submitted: 'На проверке',
  reviewed: 'Проверено',
  revision: 'На доработке',
  missing: 'Не сдано',
};
type WorkStatus = keyof typeof workLabels;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить изменения. Повторите попытку.';
const title = (items: { id: string; name: string }[], id?: string | null) =>
  items.find((item) => item.id === id)?.name || '—';
const encoded = encodeURIComponent;
function teacherScope(data: Bootstrap, user: User | null) {
  const pairs = data.teachingAssignments.filter((pair) => pair.teacherId === user?.id);
  const owns = (item: { teacherId: string; groupId: string; subjectId: string }) =>
    item.teacherId === user?.id &&
    pairs.some((pair) => pair.groupId === item.groupId && pair.subjectId === item.subjectId);
  const groups = data.groups.filter((group) => pairs.some((pair) => pair.groupId === group.id));
  const lessons = data.lessons.filter((lesson) => owns(lesson) && lesson.status !== 'cancelled');
  const assignments = data.assignments.filter(owns);
  const roster = (groupId: string) =>
    data.users.filter((student) => student.role === 'student' && student.groupId === groupId);
  const subjects = (groupId: string) =>
    data.subjects.filter((subject) =>
      pairs.some((pair) => pair.groupId === groupId && pair.subjectId === subject.id),
    );
  const records = assignments.flatMap((assignment) =>
    roster(assignment.groupId).map((student) => ({
      assignment,
      student,
      work: data.submissions.find(
        (work) => work.assignmentId === assignment.id && work.studentId === student.id,
      ),
    })),
  );
  return { pairs, groups, lessons, assignments, roster, subjects, records };
}

function WorkBadge({ status }: { status: WorkStatus }) {
  const { t } = useI18n();
  return (
    <Badge
      kind={
        status === 'submitted'
          ? 'blue'
          : status === 'revision'
            ? 'amber'
            : status === 'missing'
              ? 'neutral'
              : ''
      }
    >
      {t(workLabels[status])}
    </Badge>
  );
}

function AssignmentConditions({ assignment }: { assignment: Assignment }) {
  const { t, locale } = useI18n();
  return (
    <>
      <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.description}</p>
      <ol>
        {assignment.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      <p className="small muted mt">
        {t('Срок:')} {formatDate(assignment.dueAt, locale)}, {formatTime(assignment.dueAt)}
      </p>
    </>
  );
}

function TeacherLesson({
  lesson,
  data,
  current = false,
}: {
  lesson: Lesson;
  data: Bootstrap;
  current?: boolean;
}) {
  const { t } = useI18n();
  return (
    <article className={current ? 'teacher-lesson' : 'card card-pad'}>
      <Badge kind={current ? '' : 'neutral'}>
        {current
          ? t('Сейчас на занятии')
          : `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}`}
      </Badge>
      <h2>{title(data.subjects, lesson.subjectId)}</h2>
      <p>
        {title(data.groups, lesson.groupId)} · {lesson.kind}
      </p>
      <p className="muted">
        <Icon name="pin" className="sm" /> {title(data.rooms, lesson.roomId)} ·{' '}
        {formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}
      </p>
      <Link className="button primary small mt" href={`/journal?lesson=${encoded(lesson.id)}`}>
        {t('Открыть журнал')} <Icon name="arrow" className="sm" />
      </Link>
    </article>
  );
}

export function TeacherToday() {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const scope = teacherScope(data, user);
  const lessons = scope.lessons
    .filter((lesson) => dateKey(lesson.startsAt) === dateKey(new Date(now)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const current = lessons.find((lesson) => lessonStatus(lesson, now) === 'current');
  const next = lessons.find((lesson) => lessonStatus(lesson, now) === 'upcoming');
  const pending = scope.records.filter((record) => record.work?.status === 'submitted').length;
  return (
    <>
      <PageHeading
        title={t('Добрый день, {value0}.', {
          value0: String(user?.name.split(' ')[0] || t('преподаватель')),
        })}
        description={t('{value0} · занятия, журнал и работы студентов.', {
          value0: String(formatDate(new Date(now).toISOString(), locale)),
        })}
        action={
          <Link className="button primary" href="/assignments">
            <Icon name="plus" className="sm" /> {t('Создать задание')}{' '}
          </Link>
        }
      />
      <div className="teacher-stats">
        {[
          ['calendar', lessons.length, t('Занятий сегодня')],
          ['tasks', pending, t('Работ на проверке')],
          ['users', scope.groups.length, t('Учебных групп')],
        ].map(([icon, count, label]) => (
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
      <div className="teacher-dashboard">
        {current || next ? (
          <TeacherLesson lesson={(current || next)!} data={data} current={!!current} />
        ) : (
          <section className="card card-pad">
            <EmptyState
              title={t('На сегодня занятия завершены')}
              description={t('Расписание следующих дней доступно в календаре.')}
            />
            <Link href="/schedule" className="button small">
              {t('Расписание')}{' '}
            </Link>
          </section>
        )}
        <section className="card card-pad">
          <h2>{t('Быстрые действия')}</h2>
          {[
            ['/journal', 'book', t('Журнал группы'), t('Оценки и отметки по занятиям')],
            [
              '/review',
              'tasks',
              t('Проверка работ'),
              t('{value0} работ ждут обратной связи', { value0: String(pending) }),
            ],
            ['/assignments', 'file', t('Мои задания'), t('Условия, сроки и прогресс группы')],
          ].map(([href, icon, label, description]) => (
            <Link className="teacher-shortcut" key={href} href={href}>
              <span className="stat-icon">
                <Icon name={icon} />
              </span>
              <div className="grow">
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
              <Icon name="chevron" className="sm" />
            </Link>
          ))}
        </section>
      </div>
      <div className="teacher-section-head">
        <h2>{t('Занятия сегодня')}</h2>
        <Link className="text-link" href="/schedule">
          {t('Всё расписание')} <Icon name="arrow" className="sm" />
        </Link>
      </div>
      <div className="stack">
        {lessons.length ? (
          lessons.map((lesson) => (
            <TeacherLesson
              key={lesson.id}
              lesson={lesson}
              data={data}
              current={lessonStatus(lesson, now) === 'current'}
            />
          ))
        ) : (
          <EmptyState
            title={t('Сегодня занятий нет')}
            description={t('Можно проверить работы или подготовить задания.')}
          />
        )}
      </div>
      <AnnouncementsPanel />
    </>
  );
}

export function JournalPage() {
  const params = useSearchParams();
  const lessonId = params.get('lesson') || '';
  // Old ?tab=attendance links now open this same journal.
  return <JournalContent key={lessonId} requestedLessonId={lessonId} />;
}

function GradeEditor({
  lesson,
  student,
  record,
  onClose,
}: {
  lesson: Lesson;
  student: User;
  record?: Grade;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { mutate, notify } = useStudyHub();
  const [value, setValue] = useState(record?.status === 'graded' ? String(record.grade) : '');
  const [status, setStatus] = useState<GradeStatus>(record?.status || 'unmarked');
  const [version] = useState(record?.version ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const valid =
    status !== 'graded' ||
    (value.trim() !== '' &&
      Number.isInteger(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 100);
  async function save(nextStatus = status) {
    if (locked.current) return;
    if (nextStatus === 'graded' && !valid) {
      setError('Введите целое число от 0 до 100.');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate('PUT', `/api/lessons/${encoded(lesson.id)}/grades/${encoded(student.id)}`, {
        grade: nextStatus === 'graded' ? Number(value) : null,
        status: nextStatus,
        version,
      });
      notify(t('Отметка сохранена.'));
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Оценка за занятие')}
      className="grade-editor-dialog"
      onClose={onClose}
      closeDisabled={busy}
    >
      <p className="grade-editor-student">{student.name}</p>
      <p className="small muted mb">
        {formatDate(lesson.startsAt, locale)} · {formatTime(lesson.startsAt)} · {lesson.kind}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-busy={busy}
      >
        <Field label={t('Баллы от 0 до 100')}>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            aria-label={t('Баллы от 0 до 100')}
            value={value}
            disabled={busy || status === 'absent' || status === 'not_required'}
            onChange={(event) => {
              setValue(event.target.value);
              setStatus(event.target.value === '' ? 'unmarked' : 'graded');
              setError('');
            }}
          />
        </Field>
        <div className="grade-status-options" role="group" aria-label={t('Особая отметка')}>
          {(
            [
              ['not_required', t('н.п. — оценка не предусмотрена')],
              ['absent', t('Н — отсутствие')],
            ] as const
          ).map(([option, label]) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={status === option}
                disabled={busy}
                onChange={(event) => {
                  setStatus(event.target.checked ? option : 'unmarked');
                  setValue('');
                  setError('');
                }}
              />
              <span>{t(label)}</span>
            </label>
          ))}
        </div>
        <p className="small muted mt">
          {t('Н и н.п. не учитываются в среднем балле. Ноль — полноценная оценка.')}
        </p>
        <p className="form-error error-text" role="alert">
          {t(error)}
        </p>
        <div className="grade-editor-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void save('unmarked')}
          >
            {t('Очистить')}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t('Отмена')}
          </button>
          <button type="submit" className="button primary" disabled={busy || !valid}>
            {busy ? t('Сохранение…') : t('Сохранить')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JournalContent({ requestedLessonId }: { requestedLessonId: string }) {
  const { t, locale } = useI18n();
  const { data, user, now } = useStudyHub();
  const scope = teacherScope(data, user);
  const requestedLesson = scope.lessons.find((lesson) => lesson.id === requestedLessonId);
  const [selectedGroup, setSelectedGroup] = useState(requestedLesson?.groupId || '');
  const groupId = scope.groups.some((group) => group.id === selectedGroup)
    ? selectedGroup
    : scope.groups[0]?.id || '';
  const subjects = scope.subjects(groupId);
  const [selectedSubject, setSelectedSubject] = useState(requestedLesson?.subjectId || '');
  const subjectId = subjects.some((subject) => subject.id === selectedSubject)
    ? selectedSubject
    : subjects[0]?.id || '';
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ lessonId: string; studentId: string } | null>(null);
  const students = scope.roster(groupId);
  const visibleStudents = students.filter((student) =>
    student.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
  );
  const columns = [
    ...scope.lessons
      .filter((item) => item.groupId === groupId && item.subjectId === subjectId)
      .map((item) => ({
        kind: 'lesson' as const,
        id: item.id,
        date: item.startsAt,
        label: item.kind,
      })),
    ...scope.assignments
      .filter((item) => item.groupId === groupId && item.subjectId === subjectId)
      .map((item) => ({
        kind: 'assignment' as const,
        id: item.id,
        date: item.dueAt,
        label: item.title,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const grades = new Map(
    data.grades.map((grade) => [`${grade.lessonId}:${grade.studentId}`, grade]),
  );
  const works = new Map(
    data.submissions.map((work) => [`${work.assignmentId}:${work.studentId}`, work]),
  );
  const scoreFor = (column: (typeof columns)[number], studentId: string) => {
    if (column.kind === 'lesson') return numericGrade(grades.get(`${column.id}:${studentId}`));
    const work = works.get(`${column.id}:${studentId}`);
    return work?.status === 'reviewed' ? work.grade : null;
  };
  const editingLesson = scope.lessons.find((lesson) => lesson.id === editing?.lessonId);
  const editingStudent = students.find((student) => student.id === editing?.studentId);
  return (
    <>
      <PageHeading
        title={t('Журнал группы')}
        description={t('Оценки и отметки в одной таблице.')}
      />
      {!scope.groups.length ? (
        <EmptyState
          title={t('Группы ещё не назначены')}
          description={t('Журнал появится после назначения группы и предмета администратором.')}
        />
      ) : (
        <>
          <div className="teacher-toolbar">
            <div className="teacher-filters">
              <Field label={t('Учебная группа')}>
                <select
                  aria-label={t('Группа журнала')}
                  value={groupId}
                  onChange={(event) => {
                    setSelectedGroup(event.target.value);
                    setSelectedSubject('');
                    setQuery('');
                  }}
                >
                  {scope.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('Предмет')}>
                <select
                  aria-label={t('Предмет журнала')}
                  value={subjectId}
                  onChange={(event) => setSelectedSubject(event.target.value)}
                >
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="search-field">
              <Icon name="search" className="sm" />
              <input
                aria-label={t('Поиск студента')}
                placeholder={t('Поиск студента…')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {!columns.length ? (
            <EmptyState
              title={t('Нет занятий или заданий')}
              description={t('Они появятся после добавления в расписание или создания задания.')}
            />
          ) : (
            <section className="card">
              <div className="teacher-journal-head">
                <div>
                  <h2>
                    {title(data.subjects, subjectId)} · {title(data.groups, groupId)}
                  </h2>
                  <p>
                    {t(
                      'Шкала 0–100 · Н — отсутствие · н.п. — оценка не предусмотрена · «—» — нет отметки',
                    )}
                  </p>
                </div>
              </div>
              <div className="teacher-table-wrap">
                <table className="teacher-grade-table">
                  <thead>
                    <tr>
                      <th>{t('Студент')}</th>
                      {columns.map((column) => (
                        <th
                          key={`${column.kind}-${column.id}`}
                          className={
                            column.id === requestedLessonId ? 'journal-current-column' : ''
                          }
                        >
                          <strong>{formatDate(column.date, locale)}</strong>
                          <small>
                            {column.label}
                            {column.kind === 'lesson' && Date.parse(column.date) > now && (
                              <>
                                <br />
                                {t('Будущее занятие')}
                              </>
                            )}
                          </small>
                        </th>
                      ))}
                      <th>{t('Средний балл')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => {
                      const score = average(columns.map((column) => scoreFor(column, student.id)));
                      return (
                        <tr key={student.id}>
                          <td>
                            <Person user={student} />
                          </td>
                          {columns.map((column) => {
                            const record = grades.get(`${column.id}:${student.id}`);
                            const work = works.get(`${column.id}:${student.id}`);
                            const score = scoreFor(column, student.id);
                            return (
                              <td key={`${column.kind}-${column.id}`}>
                                {column.kind === 'assignment' ? (
                                  work ? (
                                    <Link
                                      className={`grade-cell ${score == null ? 'blank' : score < 50 ? 'low' : ''}`}
                                      href={`/review?work=${encoded(work.id)}`}
                                      aria-label={t('Работа: {name}, {title}', {
                                        name: student.name,
                                        title: column.label,
                                      })}
                                    >
                                      {score ?? '—'}
                                    </Link>
                                  ) : (
                                    <span className="teacher-empty-cell">—</span>
                                  )
                                ) : (
                                  <button
                                    type="button"
                                    className={`grade-cell ${record?.status || 'unmarked'} ${score != null && score < 50 ? 'low' : ''}`}
                                    aria-label={t('Оценка: {name}, {date}, {time}, {title}', {
                                      name: student.name,
                                      date: formatDate(column.date, locale),
                                      time: formatTime(column.date),
                                      title: column.label,
                                    })}
                                    aria-haspopup="dialog"
                                    disabled={Date.parse(column.date) > now}
                                    onClick={() =>
                                      setEditing({ lessonId: column.id, studentId: student.id })
                                    }
                                  >
                                    {t(String(gradeLabel(record)))}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <span className="teacher-average">
                              {score == null
                                ? '—'
                                : new Intl.NumberFormat(locale, {
                                    maximumFractionDigits: 1,
                                  }).format(score)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!visibleStudents.length && (
                      <tr>
                        <td colSpan={columns.length + 2}>
                          <EmptyState
                            title={t('Студентов не найдено')}
                            description={t('Измените поиск или выберите другую группу.')}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="journal-help">
            {t(
              'Нажмите ячейку занятия, чтобы изменить отметку. Ячейка задания открывает проверку работы.',
            )}
          </p>
        </>
      )}
      {editingLesson && editingStudent && (
        <GradeEditor
          key={`${editingLesson.id}:${editingStudent.id}`}
          lesson={editingLesson}
          student={editingStudent}
          record={grades.get(`${editingLesson.id}:${editingStudent.id}`)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
function FilePreview({ file }: { file: StoredFile }) {
  const { t } = useI18n();
  const { downloadFile, notify } = useStudyHub();
  const [preview, setPreview] = useState<{
    kind: 'text' | 'image' | 'pdf' | 'download';
    value: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectURL: string | null = null;
    async function load() {
      try {
        const response = await fetch(`/api/files/${encoded(file.id)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new ApiError(
            response.status === 403
              ? 'Нет доступа к этому файлу.'
              : 'Не удалось открыть файл. Попробуйте позже.',
            response.status,
          );
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (/\.(sql|txt)$/i.test(file.name) && blob.size <= 1024 * 1024) {
          const text = await blob.text();
          if (!controller.signal.aborted) setPreview({ kind: 'text', value: text });
        } else if (['image/png', 'image/jpeg', 'application/pdf'].includes(blob.type)) {
          objectURL = URL.createObjectURL(blob);
          setPreview({ kind: blob.type === 'application/pdf' ? 'pdf' : 'image', value: objectURL });
        } else setPreview({ kind: 'download', value: '' });
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(
            error instanceof ApiError
              ? error.message
              : 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
          );
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [file.id, file.name]);
  return (
    <>
      {error ? (
        <div className="preview-empty" role="alert">
          {t(error)}
        </div>
      ) : !preview ? (
        <div className="preview-empty" role="status">
          {t('Открываем файл…')}{' '}
        </div>
      ) : preview.kind === 'text' ? (
        <pre className="work-code">{preview.value}</pre>
      ) : preview.kind === 'image' ? (
        // Uploaded files use temporary blob URLs and cannot go through the Next.js image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.value} alt={t('Прикреплённая работа студента')} className="work-image" />
      ) : preview.kind === 'pdf' ? (
        <iframe
          src={preview.value}
          sandbox=""
          title={t('Просмотр PDF работы')}
          className="work-pdf"
        />
      ) : (
        <div className="preview-empty">
          <Icon name="file" />
          <strong>{t('Для этого формата нет предпросмотра')}</strong>
          <p>{file.name}</p>
        </div>
      )}
      <div className="preview-caption">
        <button
          type="button"
          className="button small"
          onClick={() =>
            void downloadFile(file.id, file.name).catch((error) => notify(t(errorMessage(error))))
          }
        >
          <Icon name="download" className="sm" /> {t('Скачать файл')}{' '}
        </button>
      </div>
    </>
  );
}

function ReviewWorkspace({
  work,
  assignment,
  student,
  onBack,
  onNext,
}: {
  work: Submission;
  assignment: Assignment;
  student: User;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t, locale } = useI18n();
  const { data, mutate, notify } = useStudyHub();
  const drafts = useTeacherDrafts();
  const draft = drafts.reviews[work.id] || {
    grade: work.status === 'reviewed' ? work.grade : null,
    comment: work.comment || '',
    version: work.version,
  };
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  function update(next: ReviewDraft) {
    const initialGrade = work.status === 'reviewed' ? work.grade : null;
    drafts.setReview(
      work.id,
      next.grade === initialGrade && next.comment === work.comment ? null : next,
    );
    setError('');
  }
  async function publish(action: 'grade' | 'return', next = false) {
    if (lock.current) return;
    if (
      action === 'grade' &&
      (draft.grade == null ||
        !Number.isInteger(draft.grade) ||
        draft.grade < 0 ||
        draft.grade > 100)
    ) {
      setError('Введите целое число от 0 до 100.');
      return;
    }
    if (action === 'return' && !draft.comment.trim()) {
      setError('Напишите, что студенту нужно доработать.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate('PATCH', `/api/submissions/${encoded(work.id)}/review`, {
        action,
        grade: action === 'return' ? null : draft.grade,
        comment: draft.comment.trim(),
        version: draft.version,
      });
      drafts.setReview(work.id, null);
      notify(action === 'return' ? t('Работа возвращена на доработку.') : t('Оценка сохранена.'));
      if (next) onNext();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="text-link back-link" onClick={onBack} disabled={busy}>
        <Icon name="left" className="sm" /> {t('К списку работ')}{' '}
      </button>
      <div className="review-workspace-head">
        <div>
          <h1>{student.name}</h1>
          <p>
            {title(data.groups, student.groupId)} · {assignment.title}
          </p>
        </div>
      </div>
      <div className="review-layout">
        <div>
          <section className="card work-preview">
            <header className="work-preview-header">
              <Icon name="file" />
              <div className="grow">
                <strong>{work.file.name}</strong>
                <small>
                  {formatDate(work.submittedAt, locale)} · {formatTime(work.submittedAt)}
                </small>
              </div>
              <WorkBadge status={work.status} />
            </header>
            <FilePreview key={work.file.id} file={work.file} />
          </section>
          <details className="work-conditions">
            <summary>{t('Условия задания и требования')}</summary>
            <div className="conditions-content">
              <AssignmentConditions assignment={assignment} />
            </div>
          </details>
        </div>
        <aside className="card review-feedback">
          {work.status !== 'submitted' && (
            <div className={`review-published ${work.status === 'revision' ? 'revision' : ''}`}>
              {work.status === 'reviewed'
                ? t('Выставлена оценка {value0}', { value0: String(work.grade) })
                : t('Работа возвращена на доработку.')}
              {work.comment && <p>{work.comment}</p>}
            </div>
          )}
          <h2>{t('Оценка и обратная связь')}</h2>
          <p className="caption">{t('Результат появится у студента после сохранения.')}</p>
          <Field label={t('Баллы за работу (0–100)')}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              aria-label={t('Баллы за работу (0–100)')}
              value={draft.grade ?? ''}
              disabled={busy}
              onChange={(event) =>
                update({
                  ...draft,
                  grade: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>{' '}
          <Field label={t('Комментарий студенту')}>
            <textarea
              aria-label={t('Комментарий студенту')}
              maxLength={2000}
              placeholder={t('Что получилось и что стоит улучшить…')}
              disabled={busy}
              value={draft.comment}
              onChange={(event) => update({ ...draft, comment: event.target.value })}
            />
          </Field>
          <div className="review-quick-comments">
            {[
              t('Хорошая работа!'),
              t('Добавьте пояснение к решению.'),
              t('Проверьте выполнение всех требований.'),
            ].map((text) => (
              <button
                type="button"
                key={text}
                disabled={busy}
                onClick={() =>
                  update({
                    ...draft,
                    comment: [draft.comment.trim(), text].filter(Boolean).join(' ').slice(0, 2000),
                  })
                }
              >
                {text}
              </button>
            ))}
          </div>
          {error && (
            <p className="review-form-error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="feedback-actions">
            <button
              type="button"
              className="button primary full"
              disabled={
                busy ||
                draft.grade == null ||
                !Number.isInteger(draft.grade) ||
                draft.grade < 0 ||
                draft.grade > 100
              }
              onClick={() => void publish('grade', true)}
            >
              {busy ? t('Сохранение…') : t('Сохранить и следующая')}{' '}
              <Icon name="arrow" className="sm" />
            </button>
            <button
              type="button"
              className="button full"
              disabled={
                busy ||
                draft.grade == null ||
                !Number.isInteger(draft.grade) ||
                draft.grade < 0 ||
                draft.grade > 100
              }
              onClick={() => void publish('grade')}
            >
              {t('Сохранить оценку')}{' '}
            </button>
            <button
              type="button"
              className="button full"
              disabled={busy}
              onClick={() => void publish('return')}
            >
              {t('Вернуть на доработку')}{' '}
            </button>
          </div>
          <p className="caption mt">
            {t('Для доработки обязательно укажите, что нужно исправить.')}
          </p>
        </aside>
      </div>
    </>
  );
}

export function ReviewPage() {
  const params = useSearchParams();
  const workId = params.get('work') || '';
  const assignmentId = params.get('assignment') || '';
  return (
    <ReviewContent
      key={`${workId}:${assignmentId}`}
      initialWorkId={workId}
      initialAssignmentId={assignmentId}
    />
  );
}

function ReviewContent({
  initialWorkId,
  initialAssignmentId,
}: {
  initialWorkId: string;
  initialAssignmentId: string;
}) {
  const { t, locale } = useI18n();
  const { data, user } = useStudyHub();
  const scope = teacherScope(data, user);
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkId || null);
  const [status, setStatus] = useState<WorkStatus>('submitted');
  const [groupId, setGroupId] = useState('');
  const [assignmentId, setAssignmentId] = useState(initialAssignmentId);
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState<Assignment | null>(null);
  const rows = scope.records
    .filter(
      (record) =>
        (!groupId || record.assignment.groupId === groupId) &&
        (!assignmentId || record.assignment.id === assignmentId) &&
        (record.work?.status || 'missing') === status &&
        `${record.student.name} ${record.assignment.title}`
          .toLocaleLowerCase('ru')
          .includes(query.trim().toLocaleLowerCase('ru')),
    )
    .sort((a, b) => (a.work?.submittedAt || '').localeCompare(b.work?.submittedAt || ''));
  const selected = scope.records.find((record) => record.work?.id === selectedId);
  if (selected?.work) {
    const index = rows.findIndex((record) => record.work?.id === selectedId);
    const nextId =
      rows.slice(index + 1).find((record) => record.work?.id !== selectedId)?.work?.id ||
      rows.find((record) => record.work && record.work.id !== selectedId)?.work?.id ||
      null;
    return (
      <ReviewWorkspace
        key={selected.work.id}
        work={selected.work}
        assignment={selected.assignment}
        student={selected.student}
        onBack={() => setSelectedId(null)}
        onNext={() => setSelectedId(nextId)}
      />
    );
  }
  return (
    <>
      <PageHeading
        title={t('Работы на проверку')}
        description={t('Сначала самые ранние сдачи. Оценка и комментарий — рядом с работой.')}
      />
      <div className="teacher-queue-tabs">
        <div className="tabs" role="group" aria-label={t('Статус проверки')}>
          {(Object.keys(workLabels) as WorkStatus[]).map((key) => (
            <button
              type="button"
              aria-pressed={status === key}
              className={status === key ? 'active' : ''}
              key={key}
              onClick={() => setStatus(key)}
            >
              {t(workLabels[key])}
              <span className="tab-number">
                {
                  scope.records.filter((record) => (record.work?.status || 'missing') === key)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="teacher-toolbar">
        <div className="teacher-filters">
          <Field label={t('Группа')}>
            <select
              aria-label={t('Группа работ')}
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value);
                setAssignmentId('');
              }}
            >
              <option value="">{t('Все мои группы')}</option>
              {scope.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Задание')}>
            <select
              aria-label={t('Задание в очереди')}
              value={assignmentId}
              onChange={(event) => setAssignmentId(event.target.value)}
            >
              <option value="">{t('Все задания')}</option>
              {scope.assignments
                .filter((assignment) => !groupId || assignment.groupId === groupId)
                .map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.title}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="search-field">
          <Icon name="search" className="sm" />
          <input
            type="search"
            aria-label={t('Поиск по работам')}
            placeholder={t('Студент или название работы…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="card teacher-table-wrap">
        {!rows.length ? (
          <EmptyState
            title={t('Работ не найдено')}
            description={
              scope.assignments.length
                ? t('Измените фильтры или дождитесь новых сдач.')
                : t('Сначала создайте задание для назначенной группы.')
            }
          />
        ) : (
          <table className="review-table">
            <thead>
              <tr>
                <th>{t('Студент')}</th>
                <th>{t('Задание')}</th>
                <th>{t('Сдача')}</th>
                <th>{t('Статус')}</th>
                <th>{t('Действие')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={`${record.assignment.id}-${record.student.id}`}>
                  <td>
                    <Person user={record.student} />
                  </td>
                  <td>
                    <div className="work-title">{record.assignment.title}</div>
                    <div className="work-meta">
                      {title(data.subjects, record.assignment.subjectId)}
                    </div>
                  </td>
                  <td>
                    {record.work ? (
                      <>
                        {formatDate(record.work.submittedAt, locale)} ·{' '}
                        {formatTime(record.work.submittedAt)}
                        {Date.parse(record.work.submittedAt) >
                          Date.parse(record.assignment.dueAt) && (
                          <div className="work-meta">{t('После срока')}</div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <WorkBadge status={record.work?.status || 'missing'} />
                    {record.work?.grade != null && (
                      <span className="grade">{record.work.grade}</span>
                    )}
                  </td>
                  <td>
                    {record.work ? (
                      <button
                        type="button"
                        className="button small"
                        onClick={() => setSelectedId(record.work!.id)}
                      >
                        {record.work.status === 'submitted' ? t('Проверить') : t('Открыть')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button small"
                        onClick={() => setInfo(record.assignment)}
                      >
                        {t('Условия')}{' '}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {info && (
        <Modal title={info.title} onClose={() => setInfo(null)}>
          <AssignmentConditions assignment={info} />
          <div className="form-actions">
            <button type="button" className="button" onClick={() => setInfo(null)}>
              {t('Закрыть')}{' '}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function NewAssignment({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { t } = useI18n();
  const { data, user, mutate, notify, now } = useStudyHub();
  const scope = teacherScope(data, user);
  const [groupId, setGroupId] = useState(scope.groups[0]?.id || '');
  const [selectedSubject, setSelectedSubject] = useState('');
  const subjects = scope.subjects(groupId);
  const subjectId = subjects.some((subject) => subject.id === selectedSubject)
    ? selectedSubject
    : subjects[0]?.id || '';
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !user) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    const dueAt = new Date(`${value('dueAt')}${value('dueAt').length === 16 ? ':00' : ''}+05:00`);
    if (!scope.pairs.some((pair) => pair.groupId === groupId && pair.subjectId === subjectId)) {
      setError('Выберите назначенные вам группу и предмет.');
      return;
    }
    if (
      !value('title') ||
      !value('description') ||
      !Number.isFinite(dueAt.getTime()) ||
      dueAt.getTime() <= now
    ) {
      setError('Заполните название, условия и будущий срок сдачи.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate('POST', '/api/assignments', {
        title: value('title'),
        description: value('description'),
        steps: value('steps')
          .split('\n')
          .map((step) => step.trim())
          .filter(Boolean),
        type: value('type'),
        groupId,
        subjectId,
        teacherId: user.id,
        dueAt: dueAt.toISOString(),
      });
      notify(t('Задание создано.'));
      onCreated(groupId);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Создать задание')}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <Field label={t('Название')}>
          <input
            name="title"
            required
            maxLength={120}
            placeholder={t('Название задания')}
            disabled={busy}
          />
        </Field>
        <div className="form-row">
          <Field label={t('Группа')}>
            <select
              name="groupId"
              value={groupId}
              disabled={busy}
              onChange={(event) => {
                setGroupId(event.target.value);
                setSelectedSubject('');
              }}
            >
              {scope.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Предмет')}>
            <select
              name="subjectId"
              value={subjectId}
              disabled={busy}
              onChange={(event) => setSelectedSubject(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label={t('Срок сдачи (UTC+5)')}>
            <input type="datetime-local" name="dueAt" required disabled={busy} />
          </Field>
          <Field label={t('Тип')}>
            <select name="type" disabled={busy}>
              <option>{t('Лабораторная работа')}</option>
              <option>{t('Практическая работа')}</option>
              <option>{t('Домашнее задание')}</option>
            </select>
          </Field>
        </div>
        <Field label={t('Условия выполнения')}>
          <textarea
            name="description"
            required
            maxLength={3000}
            disabled={busy}
            placeholder={t('Что нужно сделать и какой результат приложить')}
          />
        </Field>
        <Field label={t('Этапы выполнения')}>
          <textarea
            name="steps"
            maxLength={3000}
            disabled={busy}
            placeholder={t('Один этап на строку')}
          />
        </Field>
        {error && (
          <p className="error-text" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            {t('Отмена')}{' '}
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? t('Создание…') : t('Создать задание')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AssignmentsPage() {
  const { t, locale } = useI18n();
  const { data, user } = useStudyHub();
  const scope = teacherScope(data, user);
  const [groupId, setGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState<Assignment | null>(null);
  const assignments = scope.assignments.filter(
    (assignment) => !groupId || assignment.groupId === groupId,
  );
  return (
    <>
      <PageHeading
        title={t('Мои задания')}
        description={t('Условия, сроки и прогресс каждой группы.')}
        action={
          <button
            type="button"
            className="button primary"
            disabled={!scope.pairs.length}
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" className="sm" /> {t('Создать задание')}{' '}
          </button>
        }
      />
      <div className="teacher-toolbar">
        <div className="teacher-filters">
          <Field label={t('Группа')}>
            <select
              aria-label={t('Группа заданий')}
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              <option value="">{t('Все мои группы')}</option>
              {scope.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      {!assignments.length ? (
        <EmptyState
          title={t('Заданий пока нет')}
          description={
            scope.pairs.length
              ? t('Создайте задание для своей группы.')
              : t('Администратор ещё не назначил вам группы и предметы.')
          }
        />
      ) : (
        <div className="teacher-assignments">
          {assignments.map((assignment) => {
            const records = scope.records.filter(
              (record) => record.assignment.id === assignment.id,
            );
            return (
              <article className="card teacher-assignment-card" key={assignment.id}>
                <Badge kind="neutral">{title(data.groups, assignment.groupId)}</Badge>
                <h2>{assignment.title}</h2>
                <p>
                  {title(data.subjects, assignment.subjectId)} {t('· до')}{' '}
                  {formatDate(assignment.dueAt, locale)}, {formatTime(assignment.dueAt)}
                </p>
                <div className="teacher-assignment-counts">
                  {(['submitted', 'reviewed', 'missing'] as WorkStatus[]).map((status) => (
                    <div key={status}>
                      <strong>
                        {
                          records.filter((record) => (record.work?.status || 'missing') === status)
                            .length
                        }
                      </strong>
                      <small>{t(workLabels[status])}</small>
                    </div>
                  ))}
                </div>
                <div className="card-actions">
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setInfo(assignment)}
                  >
                    {t('Условия')}{' '}
                  </button>
                  <Link
                    className="button small primary"
                    href={`/review?assignment=${encoded(assignment.id)}`}
                  >
                    {t('Работы группы')}{' '}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <MaterialsPanel />
      {creating && (
        <NewAssignment
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setGroupId(id);
          }}
        />
      )}
      {info && (
        <Modal title={info.title} onClose={() => setInfo(null)}>
          <AssignmentConditions assignment={info} />
          <div className="form-actions">
            <button type="button" className="button" onClick={() => setInfo(null)}>
              {t('Закрыть')}{' '}
            </button>
            <Link className="button primary" href={`/review?assignment=${encoded(info.id)}`}>
              {t('Работы группы')}{' '}
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}
