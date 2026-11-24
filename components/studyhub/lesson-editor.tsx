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
import { SearchSelect } from './search-select';
import { lessonToolsLabels } from '@/lib/studyhub/lesson-tools-labels';

export function LessonTypeButtons({
  value,
  onChange,
  disabled = false,
  availableKinds,
  label,
}: {
  value: LessonKind | '';
  onChange: (kind: LessonKind) => void;
  disabled?: boolean;
  availableKinds?: readonly LessonKind[];
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={label} className="tabs lesson-kind-tabs">
      {(['lecture', 'practice', 'srsp'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className={value === kind ? 'active' : ''}
          aria-pressed={value === kind}
          disabled={disabled || (availableKinds !== undefined && !availableKinds.includes(kind))}
          onClick={() => onChange(kind)}
        >
          {t(lessonKindLabel(kind))}
        </button>
      ))}
    </div>
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
  const ui = lessonToolsLabels[locale];
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
  const [confirmHide, setConfirmHide] = useState(false);
  const [program, setProgram] = useState('');
  const [intakeYear, setIntakeYear] = useState('');
  const [language, setLanguage] = useState('');
  const [floor, setFloor] = useState('');
  const [roomType, setRoomType] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [availability, setAvailability] = useState<{
    key: string;
    data?: RoomAvailability;
    failed?: boolean;
  }>({ key: '' });
  const selfStudy = kind === 'srsp';
  const practices = practicesForGroup(data, groupId, lesson?.id).filter((item) => !item.archivedAt);
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
  const availabilityByRoom = new Map(
    checked ? availability.data?.rooms.map((room) => [room.roomId, room]) : [],
  );
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]));
  const roomState = availabilityByRoom.get(roomId);
  const groups = data.groups.filter(
    (group) =>
      (!program || group.program === program) &&
      (!intakeYear || String(group.intakeYear) === intakeYear) &&
      (!language || group.language === language),
  );
  const floors = [
    ...new Set(data.rooms.map((room) => room.floor).filter((value) => value != null)),
  ].sort((a, b) => a! - b!);
  const roomOptions = data.rooms.map((room) => {
    const state = availabilityByRoom.get(room.id);
    const status = !state
      ? labels.unknown
      : !state.available
        ? labels.busy
        : !state.capacityOk
          ? labels.tooSmall
          : labels.free;
    return {
      id: room.id,
      name: room.name + ' · ' + status,
      search: room.number || '',
      disabled: !state?.available || !state.capacityOk,
    };
  });
  const filteredRooms = roomOptions.filter((option) => {
    const room = roomsById.get(option.id)!;
    return (
      (!floor || String(room.floor) === floor) &&
      (!roomType || room.type === roomType) &&
      (!freeOnly || !option.disabled)
    );
  });
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
  async function hideLesson() {
    if (!lesson || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate('DELETE', '/api/lessons/' + encodeURIComponent(lesson.id), {
        version: lesson.version,
      });
      notify(ui.hidden);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.chooseValid);
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

  const timingFields = (
    <div className="control-grid">
      <Field label={t('Дата')}>
        <input
          type="date"
          required={!selfStudy}
          disabled={selfStudy}
          value={selfStudy ? practice?.date || '' : date}
          onChange={(event) => {
            setDate(event.target.value);
            setRoomId('');
          }}
        />
      </Field>
      <Field label={t('Время занятия')}>
        <select
          required={!selfStudy}
          disabled={selfStudy}
          value={
            selfStudy
              ? practice?.slotId ||
                (practice?.startsAt && practice.endsAt
                  ? slotForInterval(practice.startsAt, practice.endsAt)
                  : '') ||
                ''
              : slotId
          }
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
    </div>
  );

  return (
    <Modal
      title={lesson ? t('Изменить занятие') : t('Новое занятие')}
      onClose={onClose}
      closeDisabled={busy}
    >
      <form onSubmit={save} aria-busy={busy}>
        <fieldset disabled={busy} className="lesson-form">
          <LessonTypeButtons
            value={kind}
            onChange={changeKind}
            label={labels.type}
            disabled={busy}
          />
          <SearchSelect
            label={t('Группа')}
            options={groups}
            value={groupId}
            selectedOption={data.groups.find((item) => item.id === groupId)}
            required
            placeholder={labels.choose}
            onChange={(value) => {
              setGroupId(value);
              resetSubject();
            }}
          >
            <div className="mini-filters">
              <label>
                {ui.program}
                <select value={program} onChange={(event) => setProgram(event.target.value)}>
                  <option value="">{ui.all}</option>
                  {[...new Set(data.groups.map((group) => group.program).filter(Boolean))].map(
                    (value) => (
                      <option key={value!} value={value!}>
                        {value === 'IS' ? 'ИС' : value === 'VTIPO' ? 'ВТиПО' : value}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {ui.year}
                <select value={intakeYear} onChange={(event) => setIntakeYear(event.target.value)}>
                  <option value="">{ui.all}</option>
                  {[...new Set(data.groups.map((group) => group.intakeYear).filter(Boolean))]
                    .sort()
                    .map((year) => (
                      <option key={year!} value={year!}>
                        {year}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {ui.language}
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="">{ui.all}</option>
                  <option value="kk">Қазақша</option>
                  <option value="ru">Русский</option>
                </select>
              </label>
            </div>
            {(program || intakeYear || language) && (
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setProgram('');
                  setIntakeYear('');
                  setLanguage('');
                }}
              >
                {ui.reset}
              </button>
            )}
          </SearchSelect>
          {!selfStudy && (
            <>
              {timingFields}
              <p className="small muted">{labels.break}</p>
            </>
          )}
          <div className="control-grid">
            <div className="lesson-field-group">
              <SearchSelect
                label={t('Предмет')}
                options={subjects}
                value={subjectId}
                required
                disabled={!groupId}
                selectedOption={previous(data.subjects, lesson?.subjectId)}
                placeholder={labels.choose}
                onChange={(value) => {
                  setSubjectId(value);
                  setTeacherId('');
                  setPracticeId('');
                }}
              />
              {groupId && !subjects.length && (
                <p className="small muted">
                  {selfStudy ? labels.noPractices : labels.noCurriculum}
                </p>
              )}
            </div>
            <div className="lesson-field-group">
              <SearchSelect
                label={t('Преподаватель')}
                options={teachers}
                value={teacherId}
                required
                disabled={!subjectId}
                selectedOption={previous(data.users, lesson?.teacherId)}
                placeholder={labels.choose}
                onChange={(value) => {
                  setTeacherId(value);
                  setPracticeId('');
                }}
              />
              {subjectId && !teachers.length && <p className="small muted">{labels.noTeachers}</p>}
            </div>
          </div>
          {selfStudy && (
            <>
              <SearchSelect
                label={labels.practice}
                options={matchingPractices.map((item) => ({
                  id: item.id,
                  name:
                    formatDate(item.date, locale) +
                    ' · ' +
                    formatTime(item.startsAt) +
                    ' · ' +
                    (data.rooms.find((room) => room.id === item.roomId)?.name || '—'),
                }))}
                value={practice?.id || ''}
                required
                disabled={!teacherId}
                placeholder={labels.choose}
                onChange={setPracticeId}
              />
              <p className="small muted">{ui.inherited}</p>
            </>
          )}
          {selfStudy && timingFields}
          {selfStudy ? (
            <Field label={t('Аудитория')}>
              <input
                disabled
                value={data.rooms.find((room) => room.id === practice?.roomId)?.name || '—'}
              />
            </Field>
          ) : (
            <SearchSelect
              label={t('Аудитория')}
              options={filteredRooms}
              value={roomId}
              required
              disabled={!checked}
              selectedOption={roomOptions.find((item) => item.id === roomId)}
              placeholder={labels.choose}
              onChange={setRoomId}
            >
              <div className="mini-filters">
                <label>
                  {ui.floor}
                  <select value={floor} onChange={(event) => setFloor(event.target.value)}>
                    <option value="">{ui.all}</option>
                    {floors.map((value) => (
                      <option key={value!} value={value!}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {ui.roomType}
                  <select value={roomType} onChange={(event) => setRoomType(event.target.value)}>
                    <option value="">{ui.all}</option>
                    {(['computer', 'lecture', 'laboratory', 'ordinary'] as const).map((value) => (
                      <option key={value} value={value}>
                        {ui[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mini-filter-checkbox">
                <input
                  type="checkbox"
                  checked={freeOnly}
                  disabled={!checked}
                  onChange={(event) => setFreeOnly(event.target.checked)}
                />
                {ui.freeOnly}
              </label>
              {(floor || roomType || freeOnly) && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setFloor('');
                    setRoomType('');
                    setFreeOnly(false);
                  }}
                >
                  {ui.reset}
                </button>
              )}
            </SearchSelect>
          )}
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
          {lesson && <p className="small muted">{ui.independent}</p>}
          {error && (
            <p className="form-error error-text" role="alert">
              {t(error)}
            </p>
          )}
          {confirmHide && lesson && (
            <section className="lesson-hide-confirm" aria-label={ui.hideTitle}>
              <h3>{ui.hideTitle}</h3>
              <p>{ui.hideHint}</p>
              <div className="control-group">
                <button type="button" className="button" onClick={() => setConfirmHide(false)}>
                  {ui.cancel}
                </button>
                <button type="button" className="button danger" onClick={() => void hideLesson()}>
                  {ui.hide}
                </button>
              </div>
            </section>
          )}
          <div className="form-actions">
            {lesson && (
              <div className="control-group">
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setConfirmHide(true)}
                >
                  {ui.hide}
                </button>
                <button
                  type="button"
                  className={lesson.status === 'cancelled' ? 'button' : 'button danger'}
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
              </div>
            )}
            <div className="control-group">
              <button type="button" className="button" onClick={onClose}>
                {t('Закрыть')}
              </button>
              <button type="submit" className="button primary" disabled={!validSelection || busy}>
                {busy ? t('Сохраняем…') : t('Сохранить')}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
