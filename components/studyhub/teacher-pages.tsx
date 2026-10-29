'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Assignment, AttendanceStatus, Bootstrap, Lesson, Mark, StoredFile, Submission, User } from '@/lib/studyhub/api-contract';
import { dateKey, formatDate, formatTime, lessonStatus } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading, Person } from './shared';

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'Присутствует', absent: 'Отсутствует', late: 'Опоздание', excused: 'Уважительная причина',
};
const attendanceLetters: Record<AttendanceStatus, string> = { present: 'П', absent: 'Н', late: 'О', excused: 'У' };
const attendanceKeys = Object.keys(attendanceLabels) as AttendanceStatus[];
const workLabels = { submitted: 'На проверке', reviewed: 'Проверено', revision: 'На доработке', missing: 'Не сдано' };
type WorkStatus = keyof typeof workLabels;
const gradeOptions = [2, 3, 4, 5] as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить изменения. Повторите попытку.';
const title = (items: { id: string; name: string }[], id?: string | null) => items.find(item => item.id === id)?.name || 'Не указано';
const encoded = encodeURIComponent;
const mean = (values: (number | null | undefined)[]) => {
  const grades = values.filter((value): value is number => value != null && [2, 3, 4, 5].includes(value));
  return grades.length ? (grades.reduce((sum, grade) => sum + grade, 0) / grades.length).toFixed(1).replace('.', ',') : '—';
};

function teacherScope(data: Bootstrap, user: User | null) {
  const pairs = data.teachingAssignments.filter(pair => pair.teacherId === user?.id);
  const owns = (item: { teacherId: string; groupId: string; subjectId: string }) => item.teacherId === user?.id && pairs.some(pair => pair.groupId === item.groupId && pair.subjectId === item.subjectId);
  const groups = data.groups.filter(group => pairs.some(pair => pair.groupId === group.id));
  const lessons = data.lessons.filter(lesson => owns(lesson) && lesson.status !== 'cancelled');
  const assignments = data.assignments.filter(owns);
  const roster = (groupId: string) => data.users.filter(student => student.role === 'student' && student.groupId === groupId);
  const subjects = (groupId: string) => data.subjects.filter(subject => pairs.some(pair => pair.groupId === groupId && pair.subjectId === subject.id));
  const records = assignments.flatMap(assignment => roster(assignment.groupId).map(student => ({
    assignment, student, work: data.submissions.find(work => work.assignmentId === assignment.id && work.studentId === student.id),
  })));
  return { pairs, groups, lessons, assignments, roster, subjects, records };
}

type AttendanceDraft = { entries: Record<string, AttendanceStatus | null>; version: number };
type ReviewDraft = { grade: Mark | null; comment: string; version: number };
type DraftContextValue = {
  attendance: Record<string, AttendanceDraft>;
  reviews: Record<string, ReviewDraft>;
  setAttendance: (id: string, value: AttendanceDraft | null) => void;
  setReview: (id: string, value: ReviewDraft | null) => void;
};
const DraftContext = createContext<DraftContextValue | null>(null);

function DraftProvider({ children }: { children: ReactNode }) {
  const [attendance, setAttendanceDrafts] = useState<Record<string, AttendanceDraft>>({});
  const [reviews, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const dirty = Object.keys(attendance).length > 0 || Object.keys(reviews).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const value: DraftContextValue = {
    attendance, reviews,
    setAttendance(id, value) { setAttendanceDrafts(previous => { const next = { ...previous }; if (value) next[id] = value; else delete next[id]; return next; }); },
    setReview(id, value) { setReviewDrafts(previous => { const next = { ...previous }; if (value) next[id] = value; else delete next[id]; return next; }); },
  };
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/** Keep teacher drafts when Next.js switches pages; clear them on account changes. */
export function TeacherWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useStudyHub();
  return <DraftProvider key={user?.id || 'guest'}>{children}</DraftProvider>;
}

function useTeacherDrafts() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('TeacherWorkspaceProvider is required.');
  return context;
}

function WorkBadge({ status }: { status: WorkStatus }) {
  return <Badge kind={status === 'submitted' ? 'blue' : status === 'revision' ? 'amber' : status === 'missing' ? 'neutral' : ''}>{workLabels[status]}</Badge>;
}

function AssignmentConditions({ assignment }: { assignment: Assignment }) {
  return <><p style={{ whiteSpace: 'pre-wrap' }}>{assignment.description}</p><ol>{assignment.steps.map((step, index) => <li key={index}>{step}</li>)}</ol><p className="small muted mt">Срок: {formatDate(assignment.dueAt)}, {formatTime(assignment.dueAt)}</p></>;
}

function TeacherLesson({ lesson, data, current = false }: { lesson: Lesson; data: Bootstrap; current?: boolean }) {
  return <article className={current ? 'teacher-lesson' : 'card card-pad'}>
    <Badge kind={current ? '' : 'neutral'}>{current ? 'Сейчас на занятии' : `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}`}</Badge>
    <h2>{title(data.subjects, lesson.subjectId)}</h2>
    <p>{title(data.groups, lesson.groupId)} · {lesson.kind}</p>
    <p className="muted"><Icon name="pin" className="sm" /> {title(data.rooms, lesson.roomId)} · {formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</p>
    <Link className="button primary small mt" href={`/journal?lesson=${encoded(lesson.id)}&tab=attendance`}>Открыть журнал <Icon name="arrow" className="sm" /></Link>
  </article>;
}

export function TeacherToday() {
  const { data, user, now } = useStudyHub();
  const scope = teacherScope(data, user);
  const lessons = scope.lessons.filter(lesson => dateKey(lesson.startsAt) === dateKey(new Date(now))).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const current = lessons.find(lesson => lessonStatus(lesson, now) === 'current');
  const next = lessons.find(lesson => lessonStatus(lesson, now) === 'upcoming');
  const pending = scope.records.filter(record => record.work?.status === 'submitted').length;
  return <>
    <PageHeading title={`Добрый день, ${user?.name.split(' ')[0] || 'преподаватель'}.`} description={`${formatDate(new Date(now).toISOString())} · занятия, журнал и работы студентов.`} action={<Link className="button primary" href="/assignments"><Icon name="plus" className="sm" /> Создать задание</Link>} />
    <div className="teacher-stats">{[
      ['calendar', lessons.length, 'Занятий сегодня'], ['tasks', pending, 'Работ на проверке'], ['users', scope.groups.length, 'Учебных групп'],
    ].map(([icon, count, label]) => <div className="teacher-stat" key={String(label)}><span className="stat-icon"><Icon name={String(icon)} /></span><div><strong>{count}</strong><p>{label}</p></div></div>)}</div>
    <div className="teacher-dashboard">
      {current || next ? <TeacherLesson lesson={(current || next)!} data={data} current={!!current} /> : <section className="card card-pad"><EmptyState title="На сегодня занятия завершены" description="Расписание следующих дней доступно в календаре." /><Link href="/schedule" className="button small">Расписание</Link></section>}
      <section className="card card-pad"><h2>Быстрые действия</h2>{[
        ['/journal', 'book', 'Журнал группы', 'Оценки и посещаемость по занятиям'], ['/review', 'tasks', 'Проверка работ', `${pending} работ ждут обратной связи`], ['/assignments', 'file', 'Мои задания', 'Условия, сроки и прогресс группы'],
      ].map(([href, icon, label, description]) => <Link className="teacher-shortcut" key={href} href={href}><span className="stat-icon"><Icon name={icon} /></span><div className="grow"><strong>{label}</strong><p>{description}</p></div><Icon name="chevron" className="sm" /></Link>)}</section>
    </div>
    <div className="teacher-section-head"><h2>Занятия сегодня</h2><Link className="text-link" href="/schedule">Всё расписание <Icon name="arrow" className="sm" /></Link></div>
    <div className="stack">{lessons.length ? lessons.map(lesson => <TeacherLesson key={lesson.id} lesson={lesson} data={data} current={lessonStatus(lesson, now) === 'current'} />) : <EmptyState title="Сегодня занятий нет" description="Можно проверить работы или подготовить задания." />}</div>
    {!!data.announcements.length && <section className="card card-pad mt"><h2>Объявления</h2><div className="stack mt">{data.announcements.slice(0, 4).map(item => <article key={item.id}><h3>{item.title}</h3><p className="muted">{item.body}</p></article>)}</div></section>}
  </>;
}

export function JournalPage() {
  const params = useSearchParams();
  const lessonId = params.get('lesson') || '';
  const tab = params.get('tab') || '';
  return <JournalContent key={`${lessonId}:${tab}`} requestedLessonId={lessonId} initialTab={tab} />;
}

function JournalContent({ requestedLessonId, initialTab }: { requestedLessonId: string; initialTab: string }) {
  const { data, user, mutate, notify, now } = useStudyHub();
  const drafts = useTeacherDrafts();
  const scope = teacherScope(data, user);
  const requestedLesson = scope.lessons.find(lesson => lesson.id === requestedLessonId);
  const [selectedGroup, setSelectedGroup] = useState(requestedLesson?.groupId || '');
  const groupId = scope.groups.some(group => group.id === selectedGroup) ? selectedGroup : scope.groups[0]?.id || '';
  const subjects = scope.subjects(groupId);
  const [selectedSubject, setSelectedSubject] = useState(requestedLesson?.subjectId || '');
  const subjectId = subjects.some(subject => subject.id === selectedSubject) ? selectedSubject : subjects[0]?.id || '';
  const lessons = scope.lessons.filter(lesson => lesson.groupId === groupId && lesson.subjectId === subjectId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const [selectedLesson, setSelectedLesson] = useState(requestedLesson?.id || '');
  const lesson = lessons.find(item => item.id === selectedLesson) || lessons.filter(item => Date.parse(item.startsAt) <= now).at(-1) || lessons[0];
  const [tab, setTab] = useState(initialTab === 'attendance' ? 'attendance' : 'grades');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const students = scope.roster(groupId);
  const visibleStudents = students.filter(student => student.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  const columns = [
    ...lessons.map(item => ({ kind: 'lesson' as const, id: item.id, date: item.startsAt, label: item.kind })),
    ...scope.assignments.filter(item => item.groupId === groupId && item.subjectId === subjectId).map(item => ({ kind: 'assignment' as const, id: item.id, date: item.dueAt, label: item.title })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const gradeFor = (column: typeof columns[number], studentId: string) => column.kind === 'lesson'
    ? data.grades.find(grade => grade.lessonId === column.id && grade.studentId === studentId)?.grade
    : data.submissions.find(work => work.assignmentId === column.id && work.studentId === studentId && work.status === 'reviewed')?.grade;
  const committed: Record<string, AttendanceStatus | null> = Object.fromEntries(data.attendance.filter(item => item.lessonId === lesson?.id).map(item => [item.studentId, item.status]));
  const draft = lesson && drafts.attendance[lesson.id];
  const entries = draft?.entries || committed;
  const attendanceVersion = draft?.version ?? lesson?.attendanceVersion ?? 0;
  const dirty = students.some(student => (entries[student.id] || null) !== (committed[student.id] || null));
  const future = !lesson || Date.parse(lesson.startsAt) > now;

  async function saveGrade(lessonId: string, studentId: string, value: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const record = data.grades.find(grade => grade.lessonId === lessonId && grade.studentId === studentId);
    try {
      await mutate('PUT', `/api/lessons/${encoded(lessonId)}/grades/${encoded(studentId)}`, { grade: value === '' ? null : Number(value), version: record?.version ?? null });
      notify('Оценка сохранена.');
    } catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  function changeAttendance(next: Record<string, AttendanceStatus | null>) {
    if (!lesson || busy || future) return;
    const changed = students.some(student => (next[student.id] || null) !== (committed[student.id] || null));
    drafts.setAttendance(lesson.id, changed ? { entries: next, version: attendanceVersion } : null);
    setError('');
  }

  async function saveAttendance() {
    if (!lesson || locked.current || future || !dirty) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await mutate('PUT', `/api/lessons/${encoded(lesson.id)}/attendance`, { entries: students.map(student => ({ studentId: student.id, status: entries[student.id] || null })), version: attendanceVersion });
      drafts.setAttendance(lesson.id, null); notify('Посещаемость сохранена.');
    } catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <>
    <PageHeading title="Журнал группы" description="Оценки и посещаемость по занятиям." />
    {!scope.groups.length ? <EmptyState title="Группы ещё не назначены" description="Журнал появится после назначения группы и предмета администратором." /> : <>
      <div className="teacher-subtabs"><div className="tabs" role="tablist" aria-label="Раздел журнала">{[['grades', 'Оценки'], ['attendance', 'Посещаемость']].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} key={value} onClick={() => { setTab(value); setError(''); }}>{label}</button>)}</div><span className="save-state">{tab === 'grades' ? 'Оценки сохраняются после выбора' : 'Отметки сохраняются по кнопке'}</span></div>
      <div className="teacher-toolbar"><div className="teacher-filters">
        <Field label="Учебная группа"><select aria-label="Группа журнала" value={groupId} disabled={busy} onChange={event => { setSelectedGroup(event.target.value); setSelectedSubject(''); setSelectedLesson(''); setQuery(''); setError(''); }}>{scope.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
        <Field label="Предмет"><select aria-label="Предмет журнала" value={subjectId} disabled={busy} onChange={event => { setSelectedSubject(event.target.value); setSelectedLesson(''); setError(''); }}>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></Field>
        {tab === 'attendance' && <Field label="Занятие"><select className="teacher-lesson-selector" aria-label="Занятие для посещаемости" value={lesson?.id || ''} disabled={busy} onChange={event => { setSelectedLesson(event.target.value); setError(''); }}>{!lessons.length && <option value="">Нет занятий</option>}{lessons.map(item => <option key={item.id} value={item.id}>{formatDate(item.startsAt)} · {formatTime(item.startsAt)}–{formatTime(item.endsAt)}</option>)}</select></Field>}
      </div><div className="search-field"><Icon name="search" className="sm" /><input type="search" aria-label="Найти студента в журнале" placeholder="Найти студента…" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
      {error && <p className="publication-error" role="alert">{error}</p>}
      {tab === 'grades' ? <>{!columns.length ? <EmptyState title="Нет занятий или заданий" description="Они появятся после добавления в расписание или создания задания." /> : <section className="card"><div className="teacher-journal-head"><div><h2>{title(data.subjects, subjectId)} · {title(data.groups, groupId)}</h2><p>Шкала 2–5 · «—» означает отсутствие оценки</p></div></div><div className="teacher-table-wrap"><table className="teacher-grade-table"><thead><tr><th>Студент</th>{columns.map(column => <th key={`${column.kind}-${column.id}`}><strong>{formatDate(column.date)}</strong><small>{column.label}{column.kind === 'lesson' && Date.parse(column.date) > now && <><br />Будущее занятие</>}</small></th>)}<th>Средний<br />балл</th></tr></thead><tbody>{visibleStudents.map(student => <tr key={student.id}><td><Person user={student} /></td>{columns.map(column => {
        const grade = gradeFor(column, student.id);
        const work = column.kind === 'assignment' ? data.submissions.find(item => item.assignmentId === column.id && item.studentId === student.id) : undefined;
        return <td key={`${column.kind}-${column.id}`}>{column.kind === 'assignment' ? work ? <Link className={`grade-select ${grade == null ? 'blank' : ''}`} style={{ display: 'inline-grid', placeItems: 'center' }} href={`/review?work=${encoded(work.id)}`} aria-label={`Работа: ${student.name}, ${column.label}`}>{grade ?? '—'}</Link> : <span className="teacher-empty-cell">—</span> : <select className={`grade-select ${grade == null ? 'blank' : grade < 4 ? 'low' : ''}`} aria-label={`Оценка: ${student.name}, ${formatDate(column.date)}, ${formatTime(column.date)}, ${column.label}`} disabled={busy || Date.parse(column.date) > now} value={grade ?? ''} onChange={event => void saveGrade(column.id, student.id, event.target.value)}><option value="">—</option>{[5, 4, 3, 2].map(value => <option key={value} value={value}>{value}</option>)}</select>}</td>;
      })}<td><span className="teacher-average">{mean(columns.map(column => gradeFor(column, student.id)))}</span></td></tr>)}{!visibleStudents.length && <tr><td colSpan={columns.length + 2}><EmptyState title="Студентов не найдено" description="Измените поиск или выберите другую группу." /></td></tr>}</tbody></table></div></section>}<p className="journal-help">Выберите оценку за занятие. Чтобы проверить задание, откройте его ячейку.</p></> : !lesson ? <EmptyState title="Занятий пока нет" description="Выберите другую группу или предмет." /> : <>
        <section className="card"><div className="attendance-context"><div><h2>{title(data.groups, groupId)} · {formatDate(lesson.startsAt)}</h2><p>{formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)} · {title(data.rooms, lesson.roomId)} · {lesson.kind}</p></div><button type="button" className="button soft small" disabled={busy || future || !visibleStudents.some(student => !entries[student.id])} onClick={() => { const next = { ...entries }; visibleStudents.forEach(student => { if (!next[student.id]) next[student.id] = 'present'; }); changeAttendance(next); }}>{query ? 'Неотмеченные из поиска' : 'Остальные присутствуют'}</button></div>
          <div className="attendance-metrics">{attendanceKeys.map(key => <span key={key}><strong>{students.filter(student => entries[student.id] === key).length}</strong>{attendanceLabels[key]}</span>)}<span><strong>{students.filter(student => !entries[student.id]).length}</strong>Не отмечены</span></div>
          <div className="teacher-table-wrap"><table className="attendance-table"><thead><tr><th>Студент</th><th className="attendance-row-status">Отметка</th><th>П · Н · О · У</th></tr></thead><tbody>{visibleStudents.map(student => <tr key={student.id}><td><Person user={student} /></td><td className="attendance-row-status">{entries[student.id] ? attendanceLabels[entries[student.id]!] : 'Не отмечен'}</td><td><div className="attendance-buttons">{attendanceKeys.map(key => <button type="button" key={key} aria-label={`${student.name}: ${attendanceLabels[key]}`} aria-pressed={entries[student.id] === key} disabled={busy || future} className={`${key} ${entries[student.id] === key ? 'selected' : ''}`} onClick={() => changeAttendance({ ...entries, [student.id]: entries[student.id] === key ? null : key })}>{attendanceLetters[key]}</button>)}</div></td></tr>)}{!visibleStudents.length && <tr><td colSpan={3}><EmptyState title="Студентов не найдено" /></td></tr>}</tbody></table></div>
          <div className="attendance-savebar"><div><p>{future ? 'Будущее занятие' : dirty ? 'Есть несохранённые отметки' : 'Изменения сохранены'}</p><small>Студент видит только сохранённые отметки.</small></div><div className="actions"><button type="button" className="button small" disabled={busy || !dirty} onClick={() => { drafts.setAttendance(lesson.id, null); setError(''); }}>Отменить изменения</button><button type="button" className="button primary" disabled={busy || !dirty || future} onClick={() => void saveAttendance()}>{busy ? 'Сохранение…' : 'Сохранить отметки'}</button></div></div>
        </section><div className="attendance-legend">{attendanceKeys.map(key => <span key={key}><strong>{attendanceLetters[key]}</strong>{attendanceLabels[key]}</span>)}<span>Повторное нажатие снимает отметку.</span></div>
      </>}
    </>}
  </>;
}

function FilePreview({ file }: { file: StoredFile }) {
  const { downloadFile, notify } = useStudyHub();
  const [preview, setPreview] = useState<{ kind: 'text' | 'image' | 'pdf' | 'download'; value: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectURL: string | null = null;
    async function load() {
      try {
        const response = await fetch(`/api/files/${encoded(file.id)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? 'Нет доступа к этому файлу.' : 'Не удалось открыть файл. Попробуйте позже.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (/\.(sql|txt)$/i.test(file.name) && blob.size <= 1024 * 1024) {
          const text = await blob.text();
          if (!controller.signal.aborted) setPreview({ kind: 'text', value: text });
        } else if (['image/png', 'image/jpeg', 'application/pdf'].includes(blob.type)) {
          objectURL = URL.createObjectURL(blob); setPreview({ kind: blob.type === 'application/pdf' ? 'pdf' : 'image', value: objectURL });
        } else setPreview({ kind: 'download', value: '' });
      } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
    }
    void load();
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [file.id, file.name]);
  return <>
    {error ? <div className="preview-empty" role="alert">{error}</div> : !preview ? <div className="preview-empty" role="status">Открываем файл…</div> : preview.kind === 'text' ? <pre className="work-code">{preview.value}</pre> : preview.kind === 'image' ?
      // Uploaded files use temporary blob URLs and cannot go through the Next.js image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={preview.value} alt="Прикреплённая работа студента" className="work-image" /> : preview.kind === 'pdf' ? <iframe src={preview.value} sandbox="" title="Просмотр PDF работы" className="work-pdf" /> : <div className="preview-empty"><Icon name="file" /><strong>Для этого формата нет предпросмотра</strong><p>{file.name}</p></div>}
    <div className="preview-caption"><button type="button" className="button small" onClick={() => void downloadFile(file.id, file.name).catch(error => notify(errorMessage(error)))}><Icon name="download" className="sm" /> Скачать файл</button></div>
  </>;
}

function ReviewWorkspace({ work, assignment, student, onBack, onNext }: { work: Submission; assignment: Assignment; student: User; onBack: () => void; onNext: () => void }) {
  const { data, mutate, notify } = useStudyHub();
  const drafts = useTeacherDrafts();
  const draft = drafts.reviews[work.id] || { grade: work.status === 'reviewed' ? work.grade : null, comment: work.comment || '', version: work.version };
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  function update(next: ReviewDraft) {
    const initialGrade = work.status === 'reviewed' ? work.grade : null;
    drafts.setReview(work.id, next.grade === initialGrade && next.comment === work.comment ? null : next);
    setError('');
  }
  async function publish(action: 'grade' | 'return', next = false) {
    if (lock.current) return;
    if (action === 'grade' && draft.grade == null) { setError('Выберите оценку от 2 до 5.'); return; }
    if (action === 'return' && !draft.comment.trim()) { setError('Напишите, что студенту нужно доработать.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await mutate('PATCH', `/api/submissions/${encoded(work.id)}/review`, { action, grade: action === 'return' ? null : draft.grade, comment: draft.comment.trim(), version: draft.version });
      drafts.setReview(work.id, null); notify(action === 'return' ? 'Работа возвращена на доработку.' : 'Оценка сохранена.');
      if (next) onNext();
    } catch (error) { setError(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="text-link back-link" onClick={onBack} disabled={busy}><Icon name="left" className="sm" /> К списку работ</button>
    <div className="review-workspace-head"><div><h1>{student.name}</h1><p>{title(data.groups, student.groupId)} · {assignment.title}</p></div></div>
    <div className="review-layout"><div><section className="card work-preview"><header className="work-preview-header"><Icon name="file" /><div className="grow"><strong>{work.file.name}</strong><small>{formatDate(work.submittedAt)} · {formatTime(work.submittedAt)}</small></div><WorkBadge status={work.status} /></header><FilePreview key={work.file.id} file={work.file} /></section><details className="work-conditions"><summary>Условия задания и требования</summary><div className="conditions-content"><AssignmentConditions assignment={assignment} /></div></details></div>
      <aside className="card review-feedback">
        {work.status !== 'submitted' && <div className={`review-published ${work.status === 'revision' ? 'revision' : ''}`}>{work.status === 'reviewed' ? `Выставлена оценка ${work.grade}` : 'Работа возвращена на доработку.'}{work.comment && <p>{work.comment}</p>}</div>}
        <h2>Оценка и обратная связь</h2><p className="caption">Результат появится у студента после сохранения.</p>
        <div className="review-grade-picker" role="group" aria-label="Выбрать оценку за работу">{gradeOptions.map(grade => <button type="button" key={grade} aria-label={`Оценка ${grade}`} aria-pressed={draft.grade === grade} className={draft.grade === grade ? 'selected' : ''} disabled={busy} onClick={() => update({ ...draft, grade })}>{grade}</button>)}</div>
        <Field label="Комментарий студенту"><textarea aria-label="Комментарий студенту" maxLength={2000} placeholder="Что получилось и что стоит улучшить…" disabled={busy} value={draft.comment} onChange={event => update({ ...draft, comment: event.target.value })} /></Field>
        <div className="review-quick-comments">{['Хорошая работа!', 'Добавьте пояснение к решению.', 'Проверьте выполнение всех требований.'].map(text => <button type="button" key={text} disabled={busy} onClick={() => update({ ...draft, comment: [draft.comment.trim(), text].filter(Boolean).join(' ').slice(0, 2000) })}>{text}</button>)}</div>
        {error && <p className="review-form-error" role="alert">{error}</p>}
        <div className="feedback-actions"><button type="button" className="button primary full" disabled={busy || draft.grade == null} onClick={() => void publish('grade', true)}>{busy ? 'Сохранение…' : 'Сохранить и следующая'} <Icon name="arrow" className="sm" /></button><button type="button" className="button full" disabled={busy || draft.grade == null} onClick={() => void publish('grade')}>Сохранить оценку</button><button type="button" className="button full" disabled={busy} onClick={() => void publish('return')}>Вернуть на доработку</button></div>
        <p className="caption mt">Для доработки обязательно укажите, что нужно исправить.</p>
      </aside>
    </div>
  </>;
}

export function ReviewPage() {
  const params = useSearchParams();
  const workId = params.get('work') || '';
  const assignmentId = params.get('assignment') || '';
  return <ReviewContent key={`${workId}:${assignmentId}`} initialWorkId={workId} initialAssignmentId={assignmentId} />;
}

function ReviewContent({ initialWorkId, initialAssignmentId }: { initialWorkId: string; initialAssignmentId: string }) {
  const { data, user } = useStudyHub();
  const scope = teacherScope(data, user);
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkId || null);
  const [status, setStatus] = useState<WorkStatus>('submitted');
  const [groupId, setGroupId] = useState('');
  const [assignmentId, setAssignmentId] = useState(initialAssignmentId);
  const [query, setQuery] = useState('');
  const [info, setInfo] = useState<Assignment | null>(null);
  const rows = scope.records.filter(record => (!groupId || record.assignment.groupId === groupId) && (!assignmentId || record.assignment.id === assignmentId) && (record.work?.status || 'missing') === status && `${record.student.name} ${record.assignment.title}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a, b) => (a.work?.submittedAt || '').localeCompare(b.work?.submittedAt || ''));
  const selected = scope.records.find(record => record.work?.id === selectedId);
  if (selected?.work) {
    const index = rows.findIndex(record => record.work?.id === selectedId);
    const nextId = rows.slice(index + 1).find(record => record.work?.id !== selectedId)?.work?.id || rows.find(record => record.work && record.work.id !== selectedId)?.work?.id || null;
    return <ReviewWorkspace key={selected.work.id} work={selected.work} assignment={selected.assignment} student={selected.student} onBack={() => setSelectedId(null)} onNext={() => setSelectedId(nextId)} />;
  }
  return <>
    <PageHeading title="Работы на проверку" description="Сначала самые ранние сдачи. Оценка и комментарий — рядом с работой." />
    <div className="teacher-queue-tabs"><div className="tabs" role="tablist" aria-label="Статус проверки">{(Object.keys(workLabels) as WorkStatus[]).map(key => <button type="button" role="tab" aria-selected={status === key} className={status === key ? 'active' : ''} key={key} onClick={() => setStatus(key)}>{workLabels[key]}<span className="tab-number">{scope.records.filter(record => (record.work?.status || 'missing') === key).length}</span></button>)}</div></div>
    <div className="teacher-toolbar"><div className="teacher-filters"><Field label="Группа"><select aria-label="Группа работ" value={groupId} onChange={event => { setGroupId(event.target.value); setAssignmentId(''); }}><option value="">Все мои группы</option>{scope.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field><Field label="Задание"><select aria-label="Задание в очереди" value={assignmentId} onChange={event => setAssignmentId(event.target.value)}><option value="">Все задания</option>{scope.assignments.filter(assignment => !groupId || assignment.groupId === groupId).map(assignment => <option key={assignment.id} value={assignment.id}>{assignment.title}</option>)}</select></Field></div><div className="search-field"><Icon name="search" className="sm" /><input type="search" aria-label="Поиск по работам" placeholder="Студент или название работы…" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
    <div className="card teacher-table-wrap">{!rows.length ? <EmptyState title="Работ не найдено" description={scope.assignments.length ? 'Измените фильтры или дождитесь новых сдач.' : 'Сначала создайте задание для назначенной группы.'} /> : <table className="review-table"><thead><tr><th>Студент</th><th>Задание</th><th>Сдача</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{rows.map(record => <tr key={`${record.assignment.id}-${record.student.id}`}><td><Person user={record.student} /></td><td><div className="work-title">{record.assignment.title}</div><div className="work-meta">{title(data.subjects, record.assignment.subjectId)}</div></td><td>{record.work ? <>{formatDate(record.work.submittedAt)} · {formatTime(record.work.submittedAt)}{Date.parse(record.work.submittedAt) > Date.parse(record.assignment.dueAt) && <div className="work-meta">После срока</div>}</> : '—'}</td><td><WorkBadge status={record.work?.status || 'missing'} />{record.work?.grade != null && <span className="grade">{record.work.grade}</span>}</td><td>{record.work ? <button type="button" className="button small" onClick={() => setSelectedId(record.work!.id)}>{record.work.status === 'submitted' ? 'Проверить' : 'Открыть'}</button> : <button type="button" className="button small" onClick={() => setInfo(record.assignment)}>Условия</button>}</td></tr>)}</tbody></table>}</div>
    {info && <Modal title={info.title} onClose={() => setInfo(null)}><AssignmentConditions assignment={info} /><div className="form-actions"><button type="button" className="button" onClick={() => setInfo(null)}>Закрыть</button></div></Modal>}
  </>;
}

function NewAssignment({ onClose, onCreated }: { onClose: () => void; onCreated: (groupId: string) => void }) {
  const { data, user, mutate, notify, now } = useStudyHub();
  const scope = teacherScope(data, user);
  const [groupId, setGroupId] = useState(scope.groups[0]?.id || '');
  const [selectedSubject, setSelectedSubject] = useState('');
  const subjects = scope.subjects(groupId);
  const subjectId = subjects.some(subject => subject.id === selectedSubject) ? selectedSubject : subjects[0]?.id || '';
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !user) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    const dueAt = new Date(`${value('dueAt')}${value('dueAt').length === 16 ? ':00' : ''}+05:00`);
    if (!scope.pairs.some(pair => pair.groupId === groupId && pair.subjectId === subjectId)) { setError('Выберите назначенные вам группу и предмет.'); return; }
    if (!value('title') || !value('description') || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= now) { setError('Заполните название, условия и будущий срок сдачи.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await mutate('POST', '/api/assignments', { title: value('title'), description: value('description'), steps: value('steps').split('\n').map(step => step.trim()).filter(Boolean), type: value('type'), groupId, subjectId, teacherId: user.id, dueAt: dueAt.toISOString() });
      notify('Задание создано.'); onCreated(groupId);
    } catch (error) { setError(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal title="Создать задание" onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}>
    <Field label="Название"><input name="title" required maxLength={120} placeholder="Название задания" disabled={busy} /></Field>
    <div className="form-row"><Field label="Группа"><select name="groupId" value={groupId} disabled={busy} onChange={event => { setGroupId(event.target.value); setSelectedSubject(''); }}>{scope.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field><Field label="Предмет"><select name="subjectId" value={subjectId} disabled={busy} onChange={event => setSelectedSubject(event.target.value)}>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></Field></div>
    <div className="form-row"><Field label="Срок сдачи (UTC+5)"><input type="datetime-local" name="dueAt" required disabled={busy} /></Field><Field label="Тип"><select name="type" disabled={busy}><option>Лабораторная работа</option><option>Практическая работа</option><option>Домашнее задание</option></select></Field></div>
    <Field label="Условия выполнения"><textarea name="description" required maxLength={3000} disabled={busy} placeholder="Что нужно сделать и какой результат приложить" /></Field>
    <Field label="Этапы выполнения"><textarea name="steps" maxLength={3000} disabled={busy} placeholder="Один этап на строку" /></Field>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Создание…' : 'Создать задание'}</button></div>
  </form></Modal>;
}

export function AssignmentsPage() {
  const { data, user } = useStudyHub();
  const scope = teacherScope(data, user);
  const [groupId, setGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState<Assignment | null>(null);
  const assignments = scope.assignments.filter(assignment => !groupId || assignment.groupId === groupId);
  return <>
    <PageHeading title="Мои задания" description="Условия, сроки и прогресс каждой группы." action={<button type="button" className="button primary" disabled={!scope.pairs.length} onClick={() => setCreating(true)}><Icon name="plus" className="sm" /> Создать задание</button>} />
    <div className="teacher-toolbar"><div className="teacher-filters"><Field label="Группа"><select aria-label="Группа заданий" value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">Все мои группы</option>{scope.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field></div></div>
    {!assignments.length ? <EmptyState title="Заданий пока нет" description={scope.pairs.length ? 'Создайте задание для своей группы.' : 'Администратор ещё не назначил вам группы и предметы.'} /> : <div className="teacher-assignments">{assignments.map(assignment => {
      const records = scope.records.filter(record => record.assignment.id === assignment.id);
      return <article className="card teacher-assignment-card" key={assignment.id}><Badge kind="neutral">{title(data.groups, assignment.groupId)}</Badge><h2>{assignment.title}</h2><p>{title(data.subjects, assignment.subjectId)} · до {formatDate(assignment.dueAt)}, {formatTime(assignment.dueAt)}</p><div className="teacher-assignment-counts">{(['submitted', 'reviewed', 'missing'] as WorkStatus[]).map(status => <div key={status}><strong>{records.filter(record => (record.work?.status || 'missing') === status).length}</strong><small>{workLabels[status]}</small></div>)}</div><div className="card-actions"><button type="button" className="button small" onClick={() => setInfo(assignment)}>Условия</button><Link className="button small primary" href={`/review?assignment=${encoded(assignment.id)}`}>Работы группы</Link></div></article>;
    })}</div>}
    {creating && <NewAssignment onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setGroupId(id); }} />}
    {info && <Modal title={info.title} onClose={() => setInfo(null)}><AssignmentConditions assignment={info} /><div className="form-actions"><button type="button" className="button" onClick={() => setInfo(null)}>Закрыть</button><Link className="button primary" href={`/review?assignment=${encoded(info.id)}`}>Работы группы</Link></div></Modal>}
  </>;
}
