'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  Lesson,
  LessonKind,
  LessonSlotId,
  RoomAvailability,
} from '@/lib/studyhub/api-contract';
import {
  dateKey,
  formatDate,
  formatTime,
  lessonDay,
  lessonKindLabel,
} from '@/lib/studyhub/client-utils';
import { lessonSlots, slotForInterval } from '@/lib/studyhub/lesson-rules.mjs';
import {
  formLessonKind,
  practicesForGroup,
  srspInput,
  subjectsForDate,
  teachersForSubject,
} from '@/lib/studyhub/lesson-form';
import { lessonFormLabels } from '@/lib/studyhub/lesson-form-labels';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { Field, Modal } from './shared';

export function LessonTypeButtons({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: LessonKind | '';
  onChange: (kind: LessonKind) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}
    >
      {(['lecture', 'practice', 'srsp'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className={`button ${value === kind ? 'primary' : ''}`}
          aria-pressed={value === kind}
          disabled={disabled}
          onClick={() => onChange(kind)}
        >
          {t(lessonKindLabel(kind))}
        </button>
      ))}
    </div>
  );
}

function Options({
  items,
  value,
  previous,
  placeholder,
}: {
  items: { id: string; name: string }[];
  value: string;
  previous?: { id: string; name: string };
  placeholder: string;
}) {
  return (
    <>
      <option value="">{placeholder}</option>
      {previous && value === previous.id && !items.some((item) => item.id === value) && (
        <option value={previous.id}>{previous.name}</option>
      )}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );
}

export function LessonEditor({
  lesson,
  initialDate,
  onClose,
}: {
  lesson?: Lesson;
  initialDate?: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const labels = lessonFormLabels[locale];
  const { data, mutate, notify, now } = useStudyHub();
  const [kind, setKind] = useState<LessonKind | ''>(
    lesson ? formLessonKind(lesson.kind) : 'lecture',
  );
  const [date, setDate] = useState(
    lesson ? lessonDay(lesson) : initialDate || dateKey(new Date(now)),
  );
  const [groupId, setGroupId] = useState(lesson?.groupId || '');
  const [subjectId, setSubjectId] = useState(lesson?.subjectId || '');
  const [teacherId, setTeacherId] = useState(lesson?.teacherId || '');
  const [practiceId, setPracticeId] = useState(lesson?.practiceId || '');
  const [slotId, setSlotId] = useState(
    () =>
      lesson?.slotId ||
      (lesson?.startsAt && lesson.endsAt ? slotForInterval(lesson.startsAt, lesson.endsAt) : '') ||
      '',
  );
  const [roomId, setRoomId] = useState(lesson?.roomId || '');
  const [note, setNote] = useState(lesson?.note || '');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [availability, setAvailability] = useState<{
    key: string;
    data?: RoomAvailability;
    failed?: boolean;
  }>({ key: '' });
  const selfStudy = kind === 'srsp';
  const practices = practicesForGroup(data, groupId, lesson?.id);
  const subjects = selfStudy
    ? data.subjects.filter((subject) =>
        practices.some((practice) => practice.subjectId === subject.id),
      )
    : subjectsForDate(data, groupId, date);
  const teachers = teachersForSubject(data, groupId, subjectId).filter(
    (teacher) =>
      !selfStudy ||
      practices.some(
        (practice) => practice.subjectId === subjectId && practice.teacherId === teacher.id,
      ),
  );
  const matchingPractices = practices.filter(
    (practice) => practice.subjectId === subjectId && practice.teacherId === teacherId,
  );
  const practice = matchingPractices.find((item) => item.id === practiceId);
  const query =
    !selfStudy && groupId && date && slotId
      ? new URLSearchParams({
          groupId,
          date,
          slotId,
          ...(lesson ? { excludeLessonId: lesson.id } : {}),
        }).toString()
      : '';
  const queryKey = query ? `${query}&retry=${retry}` : '';
  const checked = Boolean(queryKey && availability.key === queryKey && availability.data);
  const roomState = checked
    ? availability.data?.rooms.find((room) => room.roomId === roomId)
    : undefined;
  const validSelection =
    subjects.some((item) => item.id === subjectId) &&
    teachers.some((item) => item.id === teacherId) &&
    (selfStudy
      ? Boolean(practice)
      : Boolean(slotId && roomState?.available && roomState.capacityOk));

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    fetch(`/api/rooms/availability?${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('availability');
        const result: RoomAvailability = await response.json();
        if (!Array.isArray(result.rooms)) throw new Error('availability');
        if (active) setAvailability({ key: queryKey, data: result });
      })
      .catch(() => {
        if (active) setAvailability({ key: queryKey, failed: true });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, queryKey]);

  function resetSubject() {
    setSubjectId('');
    setTeacherId('');
    setPracticeId('');
    setRoomId('');
  }
  function changeKind(next: LessonKind) {
    if (next === kind) return;
    if (next === 'srsp' || selfStudy) {
      resetSubject();
      setSlotId('');
    }
    setKind(next);
    setError('');
  }
  async function persist(body: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate(
        lesson ? 'PATCH' : 'POST',
        `/api/lessons${lesson ? `/${encodeURIComponent(lesson.id)}` : ''}`,
        { ...body, ...(lesson ? { version: lesson.version } : {}) },
      );
      notify(t('Занятие сохранено.'));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.chooseValid);
      if (!selfStudy) setRetry((value) => value + 1);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validSelection || !kind) {
      setError(labels.chooseValid);
      return;
    }
    const body =
      selfStudy && practice
        ? srspInput(practice, note)
        : {
            groupId,
            subjectId,
            teacherId,
            roomId,
            date,
            slotId: slotId as LessonSlotId,
            kind,
            practiceId: null,
            note,
          };
    void persist({ ...body, status: lesson?.status || 'scheduled' });
  }
  const previous = (items: { id: string; name: string }[], id?: string) => {
    const item = items.find((value) => value.id === id);
    return item ? { ...item, name: `${item.name} (${labels.legacy})` } : undefined;
  };

  return (
    <Modal
      title={lesson ? t('Изменить занятие') : t('Новое занятие')}
      onClose={onClose}
      closeDisabled={busy}
    >
      <form onSubmit={save} aria-busy={busy}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <LessonTypeButtons
            value={kind}
            onChange={changeKind}
            label={labels.type}
            disabled={busy}
          />
          <div className="form-row">
            <Field label={t('Группа')}>
              <select
                required
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  resetSubject();
                }}
              >
                <Options items={data.groups} value={groupId} placeholder={labels.choose} />
              </select>
            </Field>
            <Field label={t('Дата')}>
              <input
                type="date"
                required={!selfStudy}
                disabled={selfStudy}
                value={selfStudy ? practice?.date || '' : date}
                onChange={(event) => {
                  setDate(event.target.value);
                  resetSubject();
                }}
              />
            </Field>
          </div>
          <Field label={t('Предмет')}>
            <select
              required
              value={subjectId}
              disabled={!groupId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setTeacherId('');
                setPracticeId('');
              }}
            >
              <Options
                items={subjects}
                value={subjectId}
                previous={previous(data.subjects, lesson?.subjectId)}
                placeholder={labels.choose}
              />
            </select>
          </Field>
          {groupId && !subjects.length && (
            <p className="small muted">{selfStudy ? labels.noPractices : labels.noCurriculum}</p>
          )}
          <Field label={t('Преподаватель')}>
            <select
              required
              value={teacherId}
              disabled={!subjectId}
              onChange={(event) => {
                setTeacherId(event.target.value);
                setPracticeId('');
              }}
            >
              <Options
                items={teachers}
                value={teacherId}
                previous={previous(data.users, lesson?.teacherId)}
                placeholder={labels.choose}
              />
            </select>
          </Field>
          {subjectId && !teachers.length && <p className="small muted">{labels.noTeachers}</p>}
          {selfStudy && (
            <>
              <Field label={labels.practice}>
                <select
                  required
                  value={practice?.id || ''}
                  disabled={!teacherId}
                  onChange={(event) => setPracticeId(event.target.value)}
                >
                  <option value="">{labels.choose}</option>
                  {matchingPractices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatDate(item.date, locale)} · {formatTime(item.startsAt)}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="small muted">{labels.inherited}</p>
            </>
          )}
          <Field label={t('Время занятия')}>
            <select
              required={!selfStudy}
              disabled={selfStudy}
              value={selfStudy ? '' : slotId}
              onChange={(event) => {
                setSlotId(event.target.value);
                setRoomId('');
              }}
            >
              <option value="">{selfStudy ? '—' : t('Выберите пару')}</option>
              {lessonSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.start}–{slot.end}
                </option>
              ))}
            </select>
          </Field>
          {!selfStudy && <p className="small muted">{labels.break}</p>}
          <Field label={t('Аудитория')}>
            <select
              required={!selfStudy}
              disabled={selfStudy || !checked}
              value={selfStudy ? '' : roomId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              <option value="">{selfStudy ? '—' : labels.choose}</option>
              {data.rooms.map((room) => {
                const state = checked
                  ? availability.data?.rooms.find((item) => item.roomId === room.id)
                  : undefined;
                const status = !state
                  ? labels.unknown
                  : !state.available
                    ? labels.busy
                    : !state.capacityOk
                      ? labels.tooSmall
                      : labels.free;
                return (
                  <option
                    key={room.id}
                    value={room.id}
                    disabled={!state?.available || !state.capacityOk}
                  >
                    {room.name} · {status}
                  </option>
                );
              })}
            </select>
          </Field>
          {!selfStudy && (
            <div className="small muted" aria-live="polite">
              {!query ? (
                labels.chooseSlot
              ) : availability.key !== queryKey ? (
                labels.checking
              ) : availability.failed ? (
                <>
                  <p>{labels.availabilityFailed}</p>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    {labels.retry}
                  </button>
                </>
              ) : roomState ? (
                `${roomState.available ? labels.free : labels.busy}${!roomState.capacityOk ? ` · ${labels.tooSmall}` : ''}`
              ) : (
                ''
              )}
            </div>
          )}
          <Field label={t('Примечание')}>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
            />
          </Field>
          {lesson && <p className="small muted">{labels.legacyHint}</p>}
          {error && (
            <p className="form-error error-text" role="alert">
              {t(error)}
            </p>
          )}
          <div className="form-actions">
            {lesson && (
              <>
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    void persist({
                      status: lesson.status === 'cancelled' ? 'scheduled' : 'cancelled',
                    })
                  }
                >
                  {lesson.status === 'cancelled'
                    ? t('Восстановить занятие')
                    : t('Отменить занятие')}
                </button>
                <button type="button" className="button" onClick={() => void persist({ note })}>
                  {labels.saveNote}
                </button>
              </>
            )}
            <button type="button" className="button" onClick={onClose}>
              {t('Закрыть')}
            </button>
            <button type="submit" className="button primary" disabled={!validSelection || busy}>
              {busy ? t('Сохраняем…') : t('Сохранить')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
