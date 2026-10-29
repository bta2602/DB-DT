'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Bootstrap, Group, Lesson, Role, Room, Subject, User } from '@/lib/studyhub/api-contract';
import { dateKey, formatDate, formatTime, lessonStatus, roles, statusNames } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading, Person } from './shared';

type DirectoryKind = 'users' | 'groups' | 'subjects' | 'rooms' | 'teachingAssignments';
type DirectoryItem = User | Group | Subject | Room;
type Editor = { kind: DirectoryKind; item?: DirectoryItem };
const directoryTitles: Record<DirectoryKind, string> = {
  users: 'пользователя', groups: 'группу', subjects: 'предмет', rooms: 'аудиторию', teachingAssignments: 'назначение',
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить изменения.';
const referenceName = (items: { id: string; name: string }[], id: string | null) => items.find(item => item.id === id)?.name || 'Не указано';

function SelectOptions({ items, blank }: { items: { id: string; name: string }[]; blank?: string }) {
  return <>{blank && <option value="">{blank}</option>}{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</>;
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="card table-wrap"><table className="data-table"><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function Statistics({ items }: { items: [number, string, string][] }) {
  return <div className="teacher-stats">{items.map(([value, label, icon]) => <div className="teacher-stat" key={label}><span className="stat-icon"><Icon name={icon} /></span><div><strong>{value}</strong><p>{label}</p></div></div>)}</div>;
}

export function LessonList({ lessons, onEdit, now }: { lessons: Lesson[]; onEdit?: (lesson: Lesson) => void; now?: number }) {
  const { data, now: snapshotTime } = useStudyHub();
  if (!lessons.length) return <div className="card"><EmptyState title="Занятий пока нет" description="Здесь появится опубликованное расписание." /></div>;
  return <div className="schedule-list">{lessons.map(lesson => {
    const status = lessonStatus(lesson, now ?? snapshotTime);
    return <div className="publication-lesson" key={lesson.id}>
      <div className="lesson-time">{formatTime(lesson.startsAt)}<small>{formatTime(lesson.endsAt)}</small></div>
      <span className="subject-icon"><Icon name="book" /></span>
      <div className="grow"><strong>{referenceName(data.subjects, lesson.subjectId)}</strong><p>{lesson.kind} · {referenceName(data.users, lesson.teacherId)}</p><small>{referenceName(data.groups, lesson.groupId)} · Ауд. {referenceName(data.rooms, lesson.roomId)}</small></div>
      <Badge kind={status === 'current' ? '' : status === 'cancelled' ? 'red' : 'neutral'}>{statusNames[status]}</Badge>
      {onEdit && <button type="button" className="button small" onClick={() => onEdit(lesson)} aria-label={`Изменить занятие ${referenceName(data.subjects, lesson.subjectId)}`}><Icon name="edit" className="sm" /></button>}
    </div>;
  })}</div>;
}

function missingReferences(data: Bootstrap) {
  return [
    { kind: 'groups' as const, label: 'Группа', action: 'Добавить группу', ready: data.groups.length > 0 },
    { kind: 'subjects' as const, label: 'Предмет', action: 'Добавить предмет', ready: data.subjects.length > 0 },
    { kind: 'users' as const, label: 'Преподаватель', action: 'Добавить преподавателя', ready: data.users.some(user => user.role === 'teacher') },
    { kind: 'rooms' as const, label: 'Аудитория', action: 'Добавить аудиторию', ready: data.rooms.length > 0 },
  ].filter(item => !item.ready);
}

function SetupHint({ onOpen }: { onOpen: () => void }) {
  const { data } = useStudyHub();
  const missing = missingReferences(data);
  if (!missing.length) return null;
  return <section className="lesson-setup-hint" aria-label="Подготовка расписания"><div><strong>Подготовьте первое занятие</strong><p>Добавьте недостающие данные: {missing.map(item => item.label.toLocaleLowerCase()).join(', ')}.</p></div><button type="button" className="button small" onClick={onOpen}>Заполнить справочники</button></section>;
}

function DirectoryEditor({ kind, item, onClose, onSaved, forLesson = false }: Editor & { onClose: () => void; onSaved?: () => void; forLesson?: boolean }) {
  const { data, mutate, notify } = useStudyHub();
  const oldUser = kind === 'users' ? item as User | undefined : undefined;
  const oldGroup = kind === 'groups' ? item as Group | undefined : undefined;
  const oldRoom = kind === 'rooms' ? item as Room | undefined : undefined;
  const [role, setRole] = useState<Role>(oldUser?.role || (forLesson ? 'teacher' : 'student'));
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const teachers = data.users.filter(user => user.role === 'teacher');
  const incompleteAssignment = kind === 'teachingAssignments' && (!teachers.length || !data.groups.length || !data.subjects.length);
  const close = () => { if (!busy) onClose(); };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || incompleteAssignment) return;
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || '').trim();
    const body: Record<string, unknown> = kind === 'teachingAssignments'
      ? { teacherId: value('teacherId'), groupId: value('groupId'), subjectId: value('subjectId') }
      : { name: value('name') };
    if (kind === 'users') {
      Object.assign(body, { email: value('email'), role, groupId: role === 'student' ? value('groupId') || null : null });
      if (!item) body.password = String(fields.get('password') || '');
    }
    if (kind === 'groups') Object.assign(body, { course: Number(value('course')), curatorId: value('curatorId') || null });
    if (kind === 'rooms') body.capacity = value('capacity') ? Number(value('capacity')) : null;
    if (item) body.version = item.version;
    setBusy(true); setError('');
    try {
      const path = kind === 'teachingAssignments' ? 'teaching-assignments' : kind;
      await mutate(kind === 'teachingAssignments' ? 'PUT' : item ? 'PATCH' : 'POST', `/api/${path}${item ? `/${encodeURIComponent(item.id)}` : ''}`, body);
      notify('Запись сохранена.');
      if (onSaved) onSaved(); else onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  return <Modal title={`${item ? 'Изменить' : 'Добавить'} ${forLesson && kind === 'users' ? 'преподавателя' : directoryTitles[kind]}`} onClose={close}>
    <form onSubmit={save} aria-busy={busy}>
      {kind === 'teachingAssignments' ? <>
        {incompleteAssignment && <p className="publication-hint">Сначала добавьте преподавателя, группу и предмет в соседних вкладках.</p>}
        <Field label="Преподаватель"><select name="teacherId" required><SelectOptions items={teachers} /></select></Field>
        <Field label="Группа"><select name="groupId" required><SelectOptions items={data.groups} /></select></Field>
        <Field label="Предмет"><select name="subjectId" required><SelectOptions items={data.subjects} /></select></Field>
      </> : <Field label={kind === 'users' ? 'Имя и фамилия' : 'Название'}><input name="name" required maxLength={120} defaultValue={item?.name || ''} /></Field>}
      {kind === 'users' && <>
        <Field label="Почта"><input name="email" type="email" required maxLength={254} defaultValue={oldUser?.email || ''} autoComplete="off" /></Field>
        <Field label="Роль"><select name="role" value={role} onChange={event => setRole(event.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {role === 'student' && <Field label="Группа студента"><select name="groupId" defaultValue={oldUser?.groupId || ''}><SelectOptions items={data.groups} blank="Без группы" /></select></Field>}
        {!item && <div className="field"><label htmlFor="new-user-password">Пароль для входа</label><div className="auth-password-control"><input id="new-user-password" name="password" type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="new-user-password-hint" /><button type="button" className="auth-password-toggle" aria-pressed={showPassword} aria-controls="new-user-password" onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Скрыть' : 'Показать'}</button></div><small id="new-user-password-hint" className="auth-field-hint">От 12 до 128 символов. Сообщите пользователю почту и пароль для входа.</small></div>}
      </>}
      {kind === 'groups' && <>
        <Field label="Курс"><input name="course" type="number" min={1} max={6} required defaultValue={oldGroup?.course || 1} /></Field>
        <Field label="Куратор"><select name="curatorId" defaultValue={oldGroup?.curatorId || ''}><SelectOptions items={teachers} blank="Не назначен" /></select></Field>
      </>}
      {kind === 'rooms' && <Field label="Вместимость"><input name="capacity" type="number" min={1} max={1000} defaultValue={oldRoom?.capacity ?? ''} /></Field>}
      <p className="form-error error-text" role="alert">{error}</p>
      <div className="form-actions"><button type="button" className="button" disabled={busy} onClick={close}>{forLesson ? 'Назад' : 'Отмена'}</button><button type="submit" className="button primary" disabled={busy || incompleteAssignment}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>
    </form>
  </Modal>;
}

function LessonEditor({ lesson, initialDate, onClose }: { lesson?: Lesson; initialDate?: string; onClose: () => void }) {
  const { data, mutate, notify, now } = useStudyHub();
  const [setup, setSetup] = useState<DirectoryKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const missing = missingReferences(data);
  const close = () => { if (!busy) onClose(); };
  if (setup) return <DirectoryEditor kind={setup} forLesson onClose={() => setSetup(null)} onSaved={() => setSetup(null)} />;
  if (missing.length) return <Modal title="Подготовка первого занятия" onClose={close}>
    <p className="muted">Для расписания нужны группа, предмет, преподаватель и аудитория. Добавьте недостающие записи — затем откроется форма занятия.</p>
    <ul className="lesson-setup-list">{missing.map(item => <li key={item.kind}><span>{item.label}</span><button type="button" className="button small" onClick={() => setSetup(item.kind)}>{item.action}</button></li>)}</ul>
    <div className="form-actions"><button type="button" className="button" onClick={close}>Закрыть</button></div>
  </Modal>;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const value = (key: string) => String(fields.get(key) || '').trim();
    setError(''); setBusy(true);
    try {
      const startsAt = new Date(`${value('date')}T${value('start')}:00+05:00`).toISOString();
      const endsAt = new Date(`${value('date')}T${value('end')}:00+05:00`).toISOString();
      if (endsAt <= startsAt) throw new Error('Время окончания должно быть позже начала.');
      const body = { subjectId: value('subjectId'), groupId: value('groupId'), teacherId: value('teacherId'), roomId: value('roomId'), startsAt, endsAt, kind: value('kind'), note: value('note'), status: lesson?.status || 'scheduled', ...(lesson ? { version: lesson.version } : {}) };
      if (body.status !== 'cancelled' && data.lessons.some(other => other.id !== lesson?.id && other.status !== 'cancelled' && other.startsAt < endsAt && startsAt < other.endsAt && (other.groupId === body.groupId || other.teacherId === body.teacherId || other.roomId === body.roomId))) {
        throw new Error('Группа, преподаватель или аудитория уже заняты в это время.');
      }
      await mutate(lesson ? 'PATCH' : 'POST', `/api/lessons${lesson ? `/${encodeURIComponent(lesson.id)}` : ''}`, body);
      notify('Занятие сохранено.'); onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function toggle() {
    if (!lesson || busy) return;
    setError(''); setBusy(true);
    try {
      await mutate('PATCH', `/api/lessons/${encodeURIComponent(lesson.id)}`, { status: lesson.status === 'cancelled' ? 'scheduled' : 'cancelled', version: lesson.version });
      notify('Занятие обновлено.'); onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  return <Modal title={lesson ? 'Изменить занятие' : 'Новое занятие'} onClose={close}>
    <form onSubmit={save} aria-busy={busy}>
      <div className="form-row">
        <Field label="Предмет"><select name="subjectId" required defaultValue={lesson?.subjectId}><SelectOptions items={data.subjects} /></select></Field>
        <Field label="Группа"><select name="groupId" required defaultValue={lesson?.groupId}><SelectOptions items={data.groups} /></select></Field>
      </div>
      <Field label="Преподаватель"><select name="teacherId" required defaultValue={lesson?.teacherId}><SelectOptions items={data.users.filter(user => user.role === 'teacher')} /></select></Field>
      <div className="form-row">
        <Field label="Аудитория"><select name="roomId" required defaultValue={lesson?.roomId}><SelectOptions items={data.rooms} /></select></Field>
        <Field label="Дата"><input name="date" type="date" required defaultValue={lesson ? dateKey(lesson.startsAt) : initialDate || dateKey(new Date(now))} /></Field>
      </div>
      <div className="form-row">
        <Field label="Начало"><input name="start" type="time" required defaultValue={lesson ? formatTime(lesson.startsAt) : '09:00'} /></Field>
        <Field label="Окончание"><input name="end" type="time" required defaultValue={lesson ? formatTime(lesson.endsAt) : '10:20'} /></Field>
      </div>
      <Field label="Тип занятия"><input name="kind" required maxLength={60} defaultValue={lesson?.kind || ''} placeholder="Лекция, практика…" /></Field>
      <Field label="Примечание"><textarea name="note" maxLength={1000} defaultValue={lesson?.note || ''} /></Field>
      <p className="form-error error-text" role="alert">{error}</p>
      <div className="form-actions">
        {lesson && <button type="button" className="button danger" disabled={busy} onClick={toggle}>{lesson.status === 'cancelled' ? 'Восстановить занятие' : 'Отменить занятие'}</button>}
        <button type="button" className="button" disabled={busy} onClick={close}>Закрыть</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </form>
  </Modal>;
}

export function AdminOverview() {
  const { data, now } = useStudyHub();
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const active = data.lessons.filter(lesson => lessonStatus(lesson, now) === 'current').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const today = dateKey(new Date(now));
  const next = data.lessons.filter(lesson => lessonStatus(lesson, now) === 'upcoming' && dateKey(lesson.startsAt) === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return <>
    <PageHeading title="Учебный день под контролем." description="Кто сейчас на занятии, в какой группе и аудитории." action={<button type="button" className="button primary" onClick={() => setEditing('new')}><Icon name="plus" className="sm" />Добавить занятие</button>} />
    <SetupHint onOpen={() => setEditing('new')} />
    <Statistics items={[[active.length, 'Занятий идут сейчас', 'calendar'], [new Set(active.map(lesson => lesson.teacherId)).size, 'Преподавателей на парах', 'users'], [Math.max(0, data.rooms.length - new Set(active.map(lesson => lesson.roomId)).size), 'Свободных аудиторий', 'building']]} />
    <section><div className="section-head"><h2>Сейчас на занятиях</h2><span className="live-clock">{formatTime(new Date(now).toISOString())} · {formatDate(new Date(now).toISOString())}</span></div><LessonList lessons={active} now={now} onEdit={setEditing} /></section>
    <section className="mt"><div className="section-head"><h2>Следующие занятия</h2><Link href="/schedule" className="button small">Расписание</Link></div><LessonList lessons={next.slice(0, 6)} now={now} onEdit={setEditing} /></section>
    {editing && <LessonEditor lesson={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </>;
}

export function SchedulePage() {
  const { data, user, now } = useStudyHub();
  const [date, setDate] = useState(() => dateKey(new Date(now)));
  const [group, setGroup] = useState('');
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [editing, setEditing] = useState<Lesson | 'new' | null>(null);
  const admin = user?.role === 'admin';
  const first = new Date(`${date}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const dates = mode === 'day' ? [date] : Array.from({ length: 7 }, (_, index) => {
    const day = new Date(first); day.setUTCDate(day.getUTCDate() + index); return day.toISOString().slice(0, 10);
  });
  return <>
    <PageHeading title="Расписание" description="Занятия, преподаватели и аудитории." action={admin && <button type="button" className="button primary" onClick={() => setEditing('new')}><Icon name="plus" className="sm" />Добавить занятие</button>} />
    <div className="publication-toolbar">
      <Field label="Дата"><input type="date" required value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></Field>
      <Field label="Группа"><select value={group} onChange={event => setGroup(event.target.value)}><SelectOptions items={data.groups} blank="Все группы" /></select></Field>
      <div className="tabs" aria-label="Вид расписания">{(['day', 'week'] as const).map(value => <button type="button" key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'day' ? 'День' : 'Неделя'}</button>)}</div>
      <button type="button" className="button" onClick={() => setDate(dateKey(new Date(now)))}>Сегодня</button>
    </div>
    {admin && <SetupHint onOpen={() => setEditing('new')} />}
    <div className={mode === 'week' ? 'publication-week' : ''}>{dates.map(day => <section key={day}><h2 className="schedule-date-title">{formatDate(day)}</h2><LessonList lessons={data.lessons.filter(lesson => dateKey(lesson.startsAt) === day && (!group || lesson.groupId === group)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))} now={now} onEdit={admin ? setEditing : undefined} /></section>)}</div>
    {admin && editing && <LessonEditor lesson={editing === 'new' ? undefined : editing} initialDate={date} onClose={() => setEditing(null)} />}
  </>;
}

export function RoomsPage() {
  const { data, now } = useStudyHub();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  return <>
    <PageHeading title="Аудитории" description="Занятость помещений в текущий момент." action={<button type="button" className="button primary" onClick={() => setEditing('new')}><Icon name="plus" className="sm" />Добавить аудиторию</button>} />
    {data.rooms.length ? <Table headers={['Аудитория', 'Вместимость', 'Сейчас', 'Действие']}>{data.rooms.map(room => {
      const lesson = data.lessons.find(lesson => lesson.roomId === room.id && lessonStatus(lesson, now) === 'current');
      return <tr key={room.id}><td><strong>{room.name}</strong></td><td>{room.capacity ?? '—'}</td><td>{lesson ? <>{referenceName(data.subjects, lesson.subjectId)}<br /><span className="muted">{referenceName(data.groups, lesson.groupId)} · до {formatTime(lesson.endsAt)}</span></> : <Badge>Свободна</Badge>}</td><td><button type="button" className="button small" onClick={() => setEditing(room)} aria-label={`Изменить аудиторию ${room.name}`}>Изменить</button></td></tr>;
    })}</Table> : <EmptyState title="Аудитории ещё не добавлены" description="Добавьте помещения, чтобы составить расписание." />}
    {editing && <DirectoryEditor kind="rooms" item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </>;
}

export function PeoplePage() {
  const { data } = useStudyHub();
  const [tab, setTab] = useState<Exclude<DirectoryKind, 'rooms'>>('users');
  const [editing, setEditing] = useState<Editor | null>(null);
  const tabs = { users: 'Пользователи', groups: 'Группы', subjects: 'Предметы', teachingAssignments: 'Назначения' };
  const headers = { users: ['Пользователь', 'Почта', 'Роль', 'Действие'], groups: ['Группа', 'Курс', 'Куратор', 'Действие'], subjects: ['Предмет', 'Действие'], teachingAssignments: ['Преподаватель', 'Группа', 'Предмет'] };
  const editButton = (kind: DirectoryKind, item: DirectoryItem) => <button type="button" className="button small" onClick={() => setEditing({ kind, item })} aria-label={`Изменить: ${item.name}`}>Изменить</button>;
  return <>
    <PageHeading title="Пользователи и группы" description="Справочники учебного пространства." action={<button type="button" className="button primary" onClick={() => setEditing({ kind: tab })}><Icon name="plus" className="sm" />Добавить</button>} />
    <div className="tabs mb" aria-label="Справочники">{Object.entries(tabs).map(([value, title]) => <button type="button" key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value as typeof tab)}>{title}</button>)}</div>
    {!data[tab].length ? <EmptyState title="Пока пусто" description="Добавьте первую запись с помощью кнопки выше." /> : <Table headers={headers[tab]}>
      {tab === 'users' && data.users.map(user => <tr key={user.id}><td><Person user={user} /></td><td>{user.email}</td><td>{roles[user.role]}</td><td>{editButton('users', user)}</td></tr>)}
      {tab === 'groups' && data.groups.map(group => <tr key={group.id}><td>{group.name}</td><td>{group.course}</td><td>{group.curatorId ? referenceName(data.users, group.curatorId) : '—'}</td><td>{editButton('groups', group)}</td></tr>)}
      {tab === 'subjects' && data.subjects.map(subject => <tr key={subject.id}><td>{subject.name}</td><td>{editButton('subjects', subject)}</td></tr>)}
      {tab === 'teachingAssignments' && data.teachingAssignments.map(assignment => <tr key={`${assignment.teacherId}:${assignment.groupId}:${assignment.subjectId}`}><td>{referenceName(data.users, assignment.teacherId)}</td><td>{referenceName(data.groups, assignment.groupId)}</td><td>{referenceName(data.subjects, assignment.subjectId)}</td></tr>)}
    </Table>}
    {editing && <DirectoryEditor {...editing} onClose={() => setEditing(null)} />}
  </>;
}
