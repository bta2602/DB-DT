'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { PeriodMarks, User } from '@/lib/studyhub/api-contract';
import { lessonPeriod, campusDate } from '@/lib/studyhub/lesson-rules.mjs';
import { downloadCsv } from '@/lib/studyhub/journal-csv';
import { journalStudentName } from '@/lib/studyhub/journal-columns';
import { finalGradeFor } from '@/lib/studyhub/final-grade.mjs';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { Field, Modal, Person } from './shared';

const fields = ['rk1', 'r1', 'rk2', 'r2', 'examScore', 'finalGrade'] as const;
const shortLabels = {
  rk1: 'РК1',
  r1: 'Р1',
  rk2: 'РК2',
  r2: 'Р2',
  examScore: 'Экзамен',
  finalGrade: 'Итог',
};
const fullLabels = {
  rk1: 'Рубежный контроль 1',
  r1: 'Рейтинг 1',
  rk2: 'Рубежный контроль 2',
  r2: 'Рейтинг 2',
  examScore: 'Оценка за экзамен',
  finalGrade: 'Итоговая оценка',
};
type Period = Pick<PeriodMarks, 'academicYear' | 'semester'>;
const periodKey = (p: Period) => p.academicYear + '-' + p.semester;
const periodLabel = (p: Period, semesterLabel: string) =>
  `${p.academicYear}/${p.academicYear + 1} · ${semesterLabel} ${p.semester}`;

function PeriodEditor({
  record,
  student,
  subjectName,
  onClose,
}: {
  record: PeriodMarks;
  student: User;
  subjectName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { mutate, notify } = useStudyHub();
  const formulaId = useId();
  const [draft, setDraft] = useState({
    rk1: record.rk1?.toString() ?? '',
    r1: record.r1?.toString() ?? '',
    rk2: record.rk2?.toString() ?? '',
    r2: record.r2?.toString() ?? '',
    examScore: record.examScore?.toString() ?? '',
  });
  const score = (value: string) => (value.trim() === '' ? null : Number(value));
  const values = {
    rk1: score(draft.rk1),
    r1: score(draft.r1),
    rk2: score(draft.rk2),
    r2: score(draft.r2),
    examScore: score(draft.examScore),
  };
  const finalGrade = finalGradeFor(values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const next = {
      groupId: record.groupId,
      subjectId: record.subjectId,
      studentId: record.studentId,
      academicYear: record.academicYear,
      semester: record.semester,
      version: record.version,
      ...values,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await mutate('PUT', '/api/period-marks', next);
      notify(t('Отметка сохранена.'));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title={t('РК и рейтинги')} onClose={onClose} closeDisabled={busy}>
      <p className="grade-editor-student">{journalStudentName(student)}</p>
      <p className="small muted mb">
        {subjectName} · {periodLabel(record, t('Семестр'))}
      </p>
      <form onSubmit={save} aria-busy={busy}>
        {(
          [
            ['rk1', 'r1'],
            ['rk2', 'r2'],
          ] as const
        ).map((pair) => (
          <div className="form-row" key={pair[0]}>
            {pair.map((field) => (
              <Field key={field} label={t(fullLabels[field])}>
                <input
                  name={field}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  value={draft[field]}
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  disabled={busy}
                />
              </Field>
            ))}
          </div>
        ))}
        <div className="form-row">
          <Field label={t(fullLabels.examScore)}>
            <input
              name="examScore"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              value={draft.examScore}
              onChange={(event) => setDraft({ ...draft, examScore: event.target.value })}
              disabled={busy}
            />
          </Field>
          <Field label={t(fullLabels.finalGrade)}>
            <output
              className="period-final-grade"
              aria-label={t('Итоговая оценка')}
              aria-describedby={formulaId}
            >
              {finalGrade ?? '—'}
            </output>
          </Field>
        </div>
        <p className="small muted" id={formulaId}>
          {t('Итог = ((Р1 + Р2) / 2) × 0,6 + экзамен × 0,4')}
        </p>
        <p className="small muted">{t('Шкала 0–100. Чтобы снять оценку, очистите поле.')}</p>
        {error && (
          <p role="alert" className="form-error">
            {t(error)}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            {t('Отмена')}
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? t('Сохраняем…') : t('Сохранить')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PeriodJournal({
  groupId,
  subjectId,
  students,
}: {
  groupId: string;
  subjectId: string;
  students: User[];
}) {
  const { data, now } = useStudyHub();
  const { t } = useI18n();
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<{ student: User; record: PeriodMarks } | null>(null);
  const matches = (item: { groupId: string; subjectId: string }) =>
    item.groupId === groupId && item.subjectId === subjectId;
  const marks = data.periodMarks.filter(matches);
  const periodOf = (date: string): Period => {
    const { academicYear, semester } = lessonPeriod(date);
    return { academicYear, semester: semester === 1 ? 1 : 2 };
  };
  const current = periodOf(campusDate(now));
  const periods = new Map<string, Period>();
  for (const p of [
    current,
    ...data.groupSubjects.filter(matches),
    ...marks,
    ...data.lessons
      .filter(matches)
      .flatMap((lesson) => (lesson.date ? [periodOf(lesson.date)] : [])),
    ...data.assignments.filter(matches).flatMap((assignment) => {
      const due = Date.parse(assignment.dueAt);
      return Number.isFinite(due) ? [periodOf(campusDate(due))] : [];
    }),
  ]) {
    periods.set(periodKey(p), p);
  }
  const active = periods.get(selected) ?? current;
  const byStudent = new Map(
    marks.filter((m) => periodKey(m) === periodKey(active)).map((m) => [m.studentId, m]),
  );
  const subjectName = data.subjects.find((s) => s.id === subjectId)?.name ?? '';
  const groupName = data.groups.find((g) => g.id === groupId)?.name ?? '';
  function exportMarks() {
    downloadCsv(`studyhub-period-${periodKey(active)}.csv`, [
      [t('Группа'), groupName],
      [t('Предмет'), subjectName],
      [t('Семестр'), periodLabel(active, t('Семестр'))],
      [t('Студент'), ...fields.map((f) => t(shortLabels[f]))],
      ...students.map((s) => [
        journalStudentName(s),
        ...fields.map((f) => byStudent.get(s.id)?.[f] ?? null),
      ]),
    ]);
  }
  return (
    <section className="card">
      <div className="teacher-journal-head period-journal-head">
        <div>
          <h2>
            {subjectName} · {groupName}
          </h2>
          <p>{t('Рубежный контроль и рейтинг за каждый период семестра.')}</p>
        </div>
        <Field label={t('Семестр')}>
          <select value={periodKey(active)} onChange={(e) => setSelected(e.target.value)}>
            {[...periods.entries()]
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([key, p]) => (
                <option key={key} value={key}>
                  {periodLabel(p, t('Семестр'))}
                </option>
              ))}
          </select>
        </Field>
        <button type="button" className="button" disabled={!students.length} onClick={exportMarks}>
          {t('Скачать CSV')}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{t('Студент')}</th>
              {fields.map((f) => (
                <th scope="col" key={f} title={t(fullLabels[f])}>
                  {t(shortLabels[f])}
                </th>
              ))}
              <th scope="col">{t('Действие')}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const record = byStudent.get(student.id);
              return (
                <tr key={student.id}>
                  <td>
                    <Person user={student} />
                  </td>
                  {fields.map((f) => (
                    <td key={f}>{record?.[f] ?? '—'}</td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="button small"
                      aria-label={t('Изменить: {name}', { name: journalStudentName(student) })}
                      onClick={() =>
                        setEditor({
                          student,
                          record: record ?? {
                            groupId,
                            subjectId,
                            studentId: student.id,
                            academicYear: active.academicYear,
                            semester: active.semester,
                            rk1: null,
                            r1: null,
                            rk2: null,
                            r2: null,
                            examScore: null,
                            finalGrade: null,
                            version: 0,
                          },
                        })
                      }
                    >
                      {t('Изменить')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!students.length && (
              <tr>
                <td colSpan={fields.length + 2}>{t('Студентов не найдено')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editor && (
        <PeriodEditor {...editor} subjectName={subjectName} onClose={() => setEditor(null)} />
      )}
    </section>
  );
}

export function StudentPeriodMarks({ subjectId }: { subjectId: string }) {
  const { data, user } = useStudyHub();
  const { t } = useI18n();
  const marks = data.periodMarks
    .filter(
      (m) =>
        m.studentId === user?.id && m.subjectId === subjectId && fields.some((f) => m[f] != null),
    )
    .sort((a, b) => b.academicYear - a.academicYear || b.semester - a.semester);
  return (
    <section className="card table-wrap mb">
      <table className="data-table">
        <caption className="period-caption">{t('РК и рейтинги')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Семестр')}</th>
            {fields.map((f) => (
              <th key={f} scope="col">
                {t(fullLabels[f])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {marks.length === 0 && (
            <tr>
              <td colSpan={fields.length + 1}>
                {t('Рубежные оценки и рейтинги пока не выставлены.')}
              </td>
            </tr>
          )}
          {marks.map((m) => (
            <tr key={m.groupId + ':' + periodKey(m)}>
              <th scope="row">{periodLabel(m, t('Семестр'))}</th>
              {fields.map((f) => (
                <td key={f}>{m[f] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
