'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Assignment, Bootstrap, Submission, User } from '@/lib/studyhub/api-contract';
import { allowedSubmissionExtensions, maxSubmissionBytes } from '@/lib/studyhub/api-contract';
import { average, dateKey, formatDate, formatTime, lessonStatus, roles, statusNames } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading } from './shared';

const attendanceLabels = { present: 'Присутствует', absent: 'Отсутствует', late: 'Опоздание', excused: 'Уважительная причина' };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
const assignmentStatus = (submission?: Submission) => submission?.status ?? 'missing';

function AssignmentCards({ assignments, onOpen }: { assignments: Assignment[]; onOpen: (id: string) => void }) {
  const { data, user } = useStudyHub();
  if (!assignments.length) return <EmptyState title="Заданий пока нет" description="Новые задания появятся после публикации преподавателем." />;
  return <div className="assignment-grid">{assignments.map(assignment => {
    const submission = data.submissions.find(item => item.assignmentId === assignment.id && item.studentId === user?.id);
    return <button type="button" className="card assignment-card" key={assignment.id} onClick={() => onOpen(assignment.id)}>
      <div className="flex between"><Badge kind={submission?.status === 'revision' ? 'amber' : submission?.status === 'reviewed' ? '' : 'neutral'}>{statusNames[assignmentStatus(submission)]}</Badge><small>{data.subjects.find(subject => subject.id === assignment.subjectId)?.name}</small></div>
      <h3>{assignment.title}</h3><p>{assignment.type}</p>
      <footer>{submission?.status === 'reviewed' ? `Оценка ${submission.grade ?? '—'} из 5` : `До ${formatDate(assignment.dueAt)}, ${formatTime(assignment.dueAt)}`}<Icon name="arrow" className="sm" /></footer>
    </button>;
  })}</div>;
}

function AssignmentDialog({ assignment, onClose }: { assignment: Assignment; onClose: () => void }) {
  const { data, user, mutate, downloadFile, notify } = useStudyHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const submission = data.submissions.find(item => item.assignmentId === assignment.id && item.studentId === user?.id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    if (!(file instanceof File) || !file.size) { setError('Выберите непустой файл.'); return; }
    if (file.size > maxSubmissionBytes) { setError('Файл больше 20 МБ.'); return; }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!allowedSubmissionExtensions.some(allowed => allowed === extension)) { setError('Этот формат не поддерживается.'); return; }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await mutate('POST', `/api/assignments/${encodeURIComponent(assignment.id)}/submission`, body);
      setFileKey(value => value + 1);
      notify('Работа отправлена.');
    } catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  }
  return <Modal title={assignment.title} onClose={onClose}>
    <Badge kind={submission?.status === 'revision' ? 'amber' : ''}>{statusNames[assignmentStatus(submission)]}</Badge>
    <p className="muted mt">{data.subjects.find(item => item.id === assignment.subjectId)?.name} · {data.groups.find(item => item.id === assignment.groupId)?.name}</p>
    <p className="mt">Срок: {formatDate(assignment.dueAt)}, {formatTime(assignment.dueAt)}</p>
    <section className="drawer-section"><h3>Что нужно сделать</h3><p className="preserve-lines">{assignment.description}</p>{assignment.steps.length > 0 && <ol>{assignment.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}</section>
    {submission && <section className="drawer-section"><h3>Отправленная работа</h3><button type="button" className="button" onClick={() => void downloadFile(submission.file.id, submission.file.name).catch(failure => notify(messageOf(failure)))}><Icon name="file" className="sm" />{submission.file.name}</button><p className="muted small mt">{formatDate(submission.submittedAt)}, {formatTime(submission.submittedAt)}</p></section>}
    {submission && ['reviewed', 'revision'].includes(submission.status) && <section className="feedback drawer-section"><div className="flex between"><h3>Обратная связь</h3>{submission.grade !== null && <span className="grade">{submission.grade}</span>}</div><p className="preserve-lines">{submission.comment || 'Без комментария'}</p></section>}
    {submission?.status !== 'reviewed' && <form onSubmit={submit} aria-busy={busy}>
      <Field label={submission ? 'Заменить файл' : 'Ваша работа'}><input key={fileKey} type="file" name="file" accept={allowedSubmissionExtensions.map(extension => `.${extension}`).join(',')} required disabled={busy} aria-describedby="submission-file-hint submission-file-error" /></Field>
      <p id="submission-file-hint" className="small muted">PDF, DOCX, ZIP, SQL, TXT или изображение · до 20 МБ</p>
      <p id="submission-file-error" className="form-error error-text" role="alert">{error}</p>
      <button className="button primary full mt" type="submit" disabled={busy}>{busy ? 'Отправляем…' : submission ? 'Отправить повторно' : 'Сдать работу'}</button>
    </form>}
  </Modal>;
}

export function StudentToday() {
  const { data, user, now } = useStudyHub();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const today = dateKey(new Date(now));
  const lessons = data.lessons.filter(lesson => lesson.groupId === user?.groupId && dateKey(lesson.startsAt) === today && lesson.status !== 'cancelled').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const tasks = data.assignments.filter(assignment => assignment.groupId === user?.groupId && !['submitted', 'reviewed'].includes(assignmentStatus(data.submissions.find(submission => submission.assignmentId === assignment.id && submission.studentId === user?.id)))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const selected = data.assignments.find(assignment => assignment.id === selectedId);
  return <>
    <PageHeading title={`С возвращением, ${user?.name.split(' ')[0] || 'студент'}!`} description={formatDate(today)} />
    <div className="teacher-stats">{[[lessons.length, 'Занятий сегодня', 'calendar'], [tasks.length, 'Заданий к выполнению', 'tasks'], [data.subjects.length, 'Учебных предметов', 'users']].map(([count, label, icon]) => <div className="teacher-stat" key={String(label)}><span className="stat-icon"><Icon name={String(icon)} /></span><div><strong>{count}</strong><p>{label}</p></div></div>)}</div>
    <div className="dashboard-grid"><div className="main-column">
      <section><div className="section-head"><h2>Сегодня на парах</h2><Link href="/schedule" className="button small">Всё расписание</Link></div>
        {lessons.length ? <div className="schedule-list">{lessons.map(lesson => {
          const status = lessonStatus(lesson, now);
          return <div key={lesson.id} className="publication-lesson"><div className="lesson-time">{formatTime(lesson.startsAt)}<small>{formatTime(lesson.endsAt)}</small></div><span className="subject-icon"><Icon name="book" /></span><div className="grow"><strong>{data.subjects.find(item => item.id === lesson.subjectId)?.name}</strong><p>{lesson.kind} · {data.users.find(item => item.id === lesson.teacherId)?.name}</p><small>{data.groups.find(item => item.id === lesson.groupId)?.name} · Ауд. {data.rooms.find(item => item.id === lesson.roomId)?.name}</small></div><Badge kind={status === 'current' ? '' : 'neutral'}>{statusNames[status]}</Badge></div>;
        })}</div> : <div className="card"><EmptyState title="На сегодня занятий нет" description="Опубликованные занятия можно посмотреть в расписании." /></div>}
      </section>
      <section><div className="section-head"><h2>Ближайшие задания</h2><Link href="/tasks" className="button small">Все задания</Link></div><AssignmentCards assignments={tasks.slice(0, 3)} onOpen={setSelectedId} /></section>
    </div><aside><section className="card card-pad"><h2>Объявления</h2>{data.announcements.length ? data.announcements.map(announcement => <article className="notice" key={announcement.id}><h3>{announcement.title}</h3><p className="preserve-lines">{announcement.body}</p><time dateTime={announcement.publishedAt}>{formatDate(announcement.publishedAt)}</time></article>) : <EmptyState title="Новых объявлений нет" description="Важные сообщения появятся здесь." />}</section></aside></div>
    {selected && <AssignmentDialog key={selected.id} assignment={selected} onClose={() => setSelectedId(null)} />}
  </>;
}

export function TasksPage() {
  const { data, user } = useStudyHub();
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const statuses = ['all', 'missing', 'submitted', 'revision', 'reviewed'] as const;
  const assignments = data.assignments.filter(assignment => assignment.groupId === user?.groupId && (status === 'all' || assignmentStatus(data.submissions.find(item => item.assignmentId === assignment.id && item.studentId === user?.id)) === status) && assignment.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const selected = data.assignments.find(assignment => assignment.id === selectedId);
  return <>
    <PageHeading title="Мои задания" description="От первого шага до обратной связи преподавателя." />
    <div className="publication-toolbar"><div className="tabs" role="group" aria-label="Статус задания">{statuses.map(item => <button type="button" key={item} className={item === status ? 'active' : ''} aria-pressed={item === status} onClick={() => setStatus(item)}>{item === 'all' ? 'Все' : statusNames[item]}</button>)}</div><input className="select" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти задание…" aria-label="Поиск задания" /></div>
    {assignments.length ? <AssignmentCards assignments={assignments} onOpen={setSelectedId} /> : <EmptyState title={query || status !== 'all' ? 'Задания не найдены' : 'Заданий пока нет'} description={query || status !== 'all' ? 'Измените поисковый запрос или выбранный статус.' : 'Новые задания появятся после публикации преподавателем.'} />}
    {selected && <AssignmentDialog key={selected.id} assignment={selected} onClose={() => setSelectedId(null)} />}
  </>;
}

function subjectGrades(data: Bootstrap, studentId: string | undefined, subjectId: string) {
  const lessonGrades = data.grades.flatMap(grade => {
    const lesson = data.lessons.find(item => item.id === grade.lessonId && item.subjectId === subjectId);
    return lesson && grade.studentId === studentId && grade.grade !== null ? [{ id: `lesson-${lesson.id}`, title: lesson.kind, date: lesson.startsAt, grade: grade.grade, comment: '' }] : [];
  });
  const workGrades = data.submissions.flatMap(submission => {
    const assignment = data.assignments.find(item => item.id === submission.assignmentId && item.subjectId === subjectId);
    return assignment && submission.studentId === studentId && submission.status === 'reviewed' && submission.grade !== null ? [{ id: `work-${submission.id}`, title: assignment.title, date: submission.submittedAt, grade: submission.grade, comment: submission.comment }] : [];
  });
  return [...lessonGrades, ...workGrades].sort((a, b) => b.date.localeCompare(a.date));
}

export function SubjectsPage() {
  const { data, user, downloadFile, notify } = useStudyHub();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'grades' | 'attendance' | 'materials'>('grades');
  const subject = data.subjects.find(item => item.id === selectedId);
  if (!subject) return <><PageHeading title="Мои предметы" description="Оценки, посещаемость и материалы." />{data.subjects.length ? <div className="subject-grid">{data.subjects.map(item => {
    const score = average(subjectGrades(data, user?.id, item.id).map(grade => grade.grade));
    return <button type="button" className="card subject-card" key={item.id} onClick={() => { setSelectedId(item.id); setTab('grades'); }}><span className="subject-icon"><Icon name="book" /></span><h3>{item.name}</h3><p>Средний балл: {score === null ? '—' : score.toFixed(1).replace('.', ',')}</p></button>;
  })}</div> : <EmptyState title="Предметов пока нет" description="Они появятся после назначения вашей группе." />}</>;
  const grades = subjectGrades(data, user?.id, subject.id);
  const attendance = data.attendance.flatMap(entry => {
    const lesson = data.lessons.find(item => item.id === entry.lessonId && item.subjectId === subject.id);
    return entry.studentId === user?.id && lesson ? [{ ...entry, lesson }] : [];
  }).sort((a, b) => b.lesson.startsAt.localeCompare(a.lesson.startsAt));
  const materials = data.materials.filter(item => item.subjectId === subject.id);
  return <>
    <button type="button" className="button text-link mb" onClick={() => setSelectedId(null)}><Icon name="left" className="sm" />Все предметы</button>
    <PageHeading title={subject.name} />
    <div className="tabs mb" role="group" aria-label="Раздел предмета">{([['grades', 'Оценки'], ['attendance', 'Посещаемость'], ['materials', 'Материалы']] as const).map(([value, label]) => <button type="button" className={tab === value ? 'active' : ''} aria-pressed={tab === value} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'grades' && (grades.length ? <div className="card table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Работа / занятие</th><th>Оценка</th><th>Комментарий</th></tr></thead><tbody>{grades.map(grade => <tr key={grade.id}><td>{formatDate(grade.date)}</td><td>{grade.title}</td><td><span className="grade">{grade.grade}</span></td><td className="preserve-lines">{grade.comment || '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="Оценок пока нет" description="Они появятся после проверки преподавателем." />)}
    {tab === 'attendance' && (attendance.length ? <div className="card table-wrap"><table className="data-table"><thead><tr><th>Дата</th><th>Занятие</th><th>Отметка</th></tr></thead><tbody>{attendance.map(entry => <tr key={entry.lessonId}><td>{formatDate(entry.lesson.startsAt)}</td><td>{entry.lesson.kind}</td><td><Badge kind={entry.status === 'absent' ? 'red' : entry.status === 'late' ? 'amber' : ''}>{attendanceLabels[entry.status]}</Badge></td></tr>)}</tbody></table></div> : <EmptyState title="Отметок пока нет" description="Преподаватель ещё не сохранил посещаемость." />)}
    {tab === 'materials' && (materials.length ? <div className="stack">{materials.map(material => <button className="button" type="button" key={material.id} onClick={() => void downloadFile(material.fileId, material.title).catch(failure => notify(messageOf(failure)))}><Icon name="file" />{material.title}</button>)}</div> : <EmptyState title="Материалов пока нет" description="Преподаватель добавит их к этому предмету." />)}
  </>;
}

function ProfileForm({ user }: { user: User }) {
  const { data, request, reloadSession, notify } = useStudyHub();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = name.trim();
    if (!value || value.length > 120) { setError('Введите имя длиной от 1 до 120 символов.'); return; }
    setBusy(true); setError('');
    try {
      await request('/api/profile', { method: 'PATCH', body: { name: value, version: user.version } });
      await reloadSession();
      notify('Профиль сохранён.');
    } catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="card card-pad profile-form" aria-busy={busy}>
    <Field label="Имя и фамилия"><input name="name" type="text" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy} autoComplete="name" /></Field>
    <Field label="Электронная почта"><input type="email" value={user.email} disabled /></Field>
    <p className="muted">{roles[user.role]}{user.groupId ? ` · ${data.groups.find(item => item.id === user.groupId)?.name || 'Группа не указана'}` : ''}</p>
    <p className="form-error error-text" role="alert">{error}</p><button className="button primary mt" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
  </form>;
}

export function ProfilePage() {
  const { user } = useStudyHub();
  return <><PageHeading title="Мой профиль" description="Данные вашего аккаунта." />{user && <ProfileForm key={`${user.id}-${user.version}`} user={user} />}</>;
}

export function AboutPage() {
  return <>
    <PageHeading title="Учёба — в одном пространстве." description="StudyHUB объединяет расписание, задания, оценки и посещаемость." />
    <div className="subject-grid">{[['calendar', 'Расписание', 'Пары, преподаватели и аудитории.'], ['tasks', 'Задания', 'Сроки, сдача работ и обратная связь.'], ['book', 'Журнал', 'Оценки и посещаемость по занятиям.']].map(([icon, title, description]) => <article className="card card-pad" key={title}><span className="subject-icon"><Icon name={icon} /></span><h2>{title}</h2><p className="muted mt">{description}</p></article>)}</div>
    <section className="card card-pad mt"><h2>Команда проекта</h2><div className="team-list">{[['DiasD3v', 'Frontend-разработчик'], ['bta2602', 'Backend-разработчик'], ['bekulanbalkashbay-dot', 'Разработчик базы данных'], ['didarochKA', 'UI/UX-дизайнер и тестировщик']].map(([name, role]) => <div key={name}><strong>{name}</strong><span>{role}</span></div>)}</div></section>
  </>;
}
