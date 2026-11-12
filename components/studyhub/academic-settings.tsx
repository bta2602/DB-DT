'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { Group } from '@/lib/studyhub/api-contract';
import { campusDate, lessonPeriod } from '@/lib/studyhub/lesson-rules.mjs';
import { assignmentOptions, groupDisplayName } from '@/lib/studyhub/campus-filters';
import { campusLabels } from '@/lib/studyhub/campus-labels';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { EmptyState, Field, PageHeading } from './shared';
import './campus-settings.css';

function useSave() {
  const { mutate, notify } = useStudyHub();
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(path: string, body: unknown, method = 'PUT') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await mutate(method, path, body);
      notify(campusLabels[locale].saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : campusLabels[locale].failed);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}

function SaveButton({
  busy,
  disabled = false,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  return (
    <button type="submit" className="button primary" disabled={busy || disabled}>
      {busy ? campusLabels[locale].saving : children}
    </button>
  );
}

function Options({ items }: { items: { id: string; name: string }[] }) {
  return items.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name}
    </option>
  ));
}

function SubjectChecks({
  selected,
  change,
  limit,
}: {
  selected: string[];
  change: (values: string[]) => void;
  limit?: number;
}) {
  const { data } = useStudyHub();
  return (
    <div className="campus-checks">
      {data.subjects.map((subject) => (
        <label key={subject.id} className="campus-check">
          <input
            type="checkbox"
            checked={selected.includes(subject.id)}
            disabled={limit != null && selected.length >= limit && !selected.includes(subject.id)}
            onChange={(event) =>
              change(
                event.target.checked
                  ? [...selected, subject.id]
                  : selected.filter((id) => id !== subject.id),
              )
            }
          />
          <span>{subject.name}</span>
        </label>
      ))}
    </div>
  );
}

function TeacherProfile({
  teacherId,
  mode,
}: {
  teacherId: string;
  mode: 'subjects' | 'languages';
}) {
  const { data } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const [subjects, setSubjects] = useState(
    data.teacherSubjects.filter((row) => row.teacherId === teacherId).map((row) => row.subjectId),
  );
  const [languages, setLanguages] = useState(
    data.teacherLanguages.filter((row) => row.teacherId === teacherId).map((row) => row.language),
  );
  const { save, busy, error } = useSave();
  return (
    <div className="campus-panel">
      <h2>{labels[mode]}</h2>
      <p className="campus-notice">
        {mode === 'subjects' && labels.teacherLimit} {labels.replaceHint}
      </p>
      {mode === 'subjects' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save('/api/academic/teacher-subjects', { teacherId, subjectIds: subjects });
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {labels.subjects} ({subjects.length}/3)
            </legend>
            <SubjectChecks selected={subjects} change={setSubjects} limit={3} />
            <SaveButton busy={busy}>{labels.saveSubjects}</SaveButton>
          </fieldset>
        </form>
      )}
      {mode === 'languages' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save('/api/academic/teacher-languages', { teacherId, languages });
          }}
        >
          <fieldset disabled={busy}>
            <legend>{labels.languages}</legend>
            <div className="campus-checks">
              {(['kk', 'ru'] as const).map((language) => (
                <label className="campus-check" key={language}>
                  <input
                    type="checkbox"
                    checked={languages.includes(language)}
                    onChange={(event) =>
                      setLanguages(
                        event.target.checked
                          ? [...languages, language]
                          : languages.filter((value) => value !== language),
                      )
                    }
                  />
                  <span>{labels[language]}</span>
                </label>
              ))}
            </div>
            <SaveButton busy={busy}>{labels.saveLanguages}</SaveButton>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GroupProfile({ group }: { group: Group }) {
  const { now } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const academicYear = lessonPeriod(campusDate(now)).academicYear;
  const [program, setProgram] = useState(group.program || '');
  const [intakeYear, setIntakeYear] = useState(
    String(group.intakeYear || academicYear - group.course + 1),
  );
  const [language, setLanguage] = useState(group.language || '');
  const name = groupDisplayName(program, Number(intakeYear), language);
  const course = academicYear - Number(intakeYear) + 1;
  const { save, busy, error } = useSave();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name) return;
    await save(
      `/api/groups/${group.id}`,
      {
        name,
        program,
        intakeYear: Number(intakeYear),
        language,
        course,
        curatorId: group.curatorId,
        version: group.version,
      },
      'PATCH',
    );
  }
  return (
    <form className="campus-panel" onSubmit={submit}>
      <h2>
        {labels.profile}: {group.name}
      </h2>
      <fieldset disabled={busy}>
        <div className="campus-grid">
          <Field label={labels.program}>
            <select
              value={program}
              required
              onChange={(event) => setProgram(event.target.value as typeof program)}
            >
              <option value="">{labels.select}</option>
              <option value="IS">{labels.programs.IS}</option>
              <option value="VTIPO">{labels.programs.VTIPO}</option>
              <option value="DS">{labels.programs.DS}</option>
            </select>
          </Field>
          <Field label={labels.intake}>
            <input
              type="number"
              min={academicYear - 5}
              max={academicYear}
              step={1}
              required
              value={intakeYear}
              onChange={(event) => setIntakeYear(event.target.value)}
            />
          </Field>
          <Field label={labels.language}>
            <select
              required
              value={language}
              onChange={(event) => setLanguage(event.target.value as typeof language)}
            >
              <option value="">{labels.select}</option>
              <option value="kk">{labels.kk}</option>
              <option value="ru">{labels.ru}</option>
            </select>
          </Field>
        </div>
        <p>
          <strong>{name || group.name}</strong>
          {name && Number.isInteger(course) && course >= 1 && course <= 6
            ? ` · ${labels.course}: ${course}`
            : ''}
        </p>
        <p className="campus-notice">{labels.profileHint}</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <SaveButton busy={busy}>{labels.save}</SaveButton>
      </fieldset>
    </form>
  );
}

function CurriculumForm({
  groupId,
  year,
  semester,
}: {
  groupId: string;
  year: number;
  semester: number;
}) {
  const { data } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const [selected, setSelected] = useState(
    data.groupSubjects
      .filter(
        (row) => row.groupId === groupId && row.academicYear === year && row.semester === semester,
      )
      .map((row) => row.subjectId),
  );
  const { save, busy, error } = useSave();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save('/api/academic/group-subjects', {
          groupId,
          academicYear: year,
          semester,
          subjectIds: selected,
        });
      }}
    >
      <fieldset disabled={busy || !Number.isInteger(year) || year < 2000 || year > 9998}>
        <p className="campus-notice">
          {labels.replaceHint} {labels.subjects}: {selected.length}
        </p>
        <SubjectChecks selected={selected} change={setSelected} />
        {!selected.length && <p className="campus-notice">{labels.emptySubjects}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <SaveButton busy={busy}>{labels.savePlan}</SaveButton>
      </fieldset>
    </form>
  );
}

function GroupSettings({ group }: { group: Group }) {
  const { data, now } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const period = lessonPeriod(campusDate(now));
  const [year, setYear] = useState(String(period.academicYear));
  const [semester, setSemester] = useState(period.semester);
  const planKey = data.groupSubjects
    .filter(
      (row) =>
        row.groupId === group.id && row.academicYear === Number(year) && row.semester === semester,
    )
    .map((row) => row.subjectId)
    .sort()
    .join(',');
  return (
    <>
      <GroupProfile key={`${group.id}:${group.version}`} group={group} />
      <div className="campus-panel">
        <h2>{labels.curriculum}</h2>
        <div className="campus-grid">
          <Field label={labels.year}>
            <input
              type="number"
              min={2000}
              max={9998}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </Field>
          <Field label={labels.semester}>
            <select value={semester} onChange={(event) => setSemester(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </Field>
        </div>
        <CurriculumForm
          key={`${group.id}:${year}:${semester}:${planKey}`}
          groupId={group.id}
          year={Number(year)}
          semester={semester}
        />
      </div>
    </>
  );
}

function Assignments() {
  const { data, now } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(campusDate(now));
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const { save, busy, error } = useSave();
  const options = assignmentOptions(data, groupId, subjectId, date);
  const subject = options.subjects.some((item) => item.id === subjectId) ? subjectId : '';
  const teacher =
    subject && options.teachers.some((item) => item.id === teacherId) ? teacherId : '';
  const language = data.groups.find((group) => group.id === groupId)?.language;
  const assigned = data.teachingAssignments.some(
    (row) => row.groupId === groupId && row.subjectId === subject && row.teacherId === teacher,
  );
  return (
    <div className="campus-panel">
      <h2>{labels.assignments}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (groupId && subject && teacher && !assigned)
            void save('/api/teaching-assignments', {
              groupId,
              subjectId: subject,
              teacherId: teacher,
              date,
            });
        }}
      >
        <fieldset disabled={busy}>
          <div className="campus-grid">
            <Field label={labels.group}>
              <select
                required
                value={groupId}
                onChange={(event) => {
                  setGroupId(event.target.value);
                  setSubjectId('');
                  setTeacherId('');
                }}
              >
                <option value="">{labels.select}</option>
                <Options items={data.groups} />
              </select>
            </Field>
            <Field label={labels.date}>
              <input
                required
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSubjectId('');
                  setTeacherId('');
                }}
              />
            </Field>
            <Field label={labels.subject}>
              <select
                required
                value={subject}
                disabled={!groupId || !options.subjects.length}
                onChange={(event) => {
                  setSubjectId(event.target.value);
                  setTeacherId('');
                }}
              >
                <option value="">{labels.select}</option>
                <Options items={options.subjects} />
              </select>
            </Field>
            <Field label={labels.teacher}>
              <select
                required
                value={teacher}
                disabled={!subject || !language || !options.teachers.length}
                onChange={(event) => setTeacherId(event.target.value)}
              >
                <option value="">{labels.select}</option>
                <Options items={options.teachers} />
              </select>
            </Field>
          </div>
          {groupId && !language && <p className="campus-notice">{labels.selectGroupLanguage}</p>}
          {groupId && !options.subjects.length && (
            <p className="campus-notice">{labels.noCurriculum}</p>
          )}
          {subject && !options.teachers.length && (
            <p className="campus-notice">{labels.noTeachers}</p>
          )}
          {assigned && <p className="campus-notice">{labels.alreadyAssigned}</p>}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <SaveButton busy={busy} disabled={!groupId || !subject || !teacher || assigned}>
            {labels.assign}
          </SaveButton>
        </fieldset>
      </form>
      {groupId && (
        <>
          <h3>{labels.currentAssignments}</h3>
          <ul>
            {data.teachingAssignments
              .filter((row) => row.groupId === groupId)
              .map((row) => (
                <li key={`${row.teacherId}:${row.subjectId}`}>
                  {data.subjects.find((item) => item.id === row.subjectId)?.name} —{' '}
                  {data.users.find((item) => item.id === row.teacherId)?.name}
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function AcademicSettings() {
  const { data, user, refresh } = useStudyHub();
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const [tab, setTab] = useState<'teachers' | 'groups' | 'assignments'>('teachers');
  const [teacherId, setTeacherId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const teachers = data.users.filter((user) => user.role === 'teacher');
  const teacher = teachers.some((user) => user.id === teacherId) ? teacherId : teachers[0]?.id;
  const group = data.groups.find((row) => row.id === groupId) || data.groups[0];
  const teacherSubjectsKey = JSON.stringify(
    data.teacherSubjects.filter((row) => row.teacherId === teacher),
  );
  const teacherLanguagesKey = JSON.stringify(
    data.teacherLanguages.filter((row) => row.teacherId === teacher),
  );
  if (user?.role !== 'admin') return <EmptyState title={labels.access} />;
  async function reload() {
    setLoading(true);
    setError('');
    try {
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <PageHeading
        title={labels.academic}
        description={labels.intro}
        action={
          <button className="button" type="button" disabled={loading} onClick={reload}>
            {labels.refresh}
          </button>
        }
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="campus-tabs" aria-label={labels.academic}>
        {(['teachers', 'groups', 'assignments'] as const).map((item) => (
          <button
            className={`button ${tab === item ? 'primary' : ''}`}
            type="button"
            aria-pressed={tab === item}
            key={item}
            onClick={() => setTab(item)}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      {tab === 'teachers' &&
        (teacher ? (
          <>
            <Field label={labels.teacher}>
              <select value={teacher} onChange={(event) => setTeacherId(event.target.value)}>
                <Options items={teachers} />
              </select>
            </Field>
            <TeacherProfile
              key={`${user.id}:${teacher}:subjects:${teacherSubjectsKey}`}
              teacherId={teacher}
              mode="subjects"
            />
            <TeacherProfile
              key={`${user.id}:${teacher}:languages:${teacherLanguagesKey}`}
              teacherId={teacher}
              mode="languages"
            />
          </>
        ) : (
          <EmptyState title={labels.noStaff} />
        ))}
      {tab === 'groups' &&
        (group ? (
          <>
            <Field label={labels.group}>
              <select value={group.id} onChange={(event) => setGroupId(event.target.value)}>
                <Options items={data.groups} />
              </select>
            </Field>
            <GroupSettings key={`${user.id}:${group.id}`} group={group} />
          </>
        ) : (
          <EmptyState title={labels.noGroups} />
        ))}
      {tab === 'assignments' && <Assignments key={user.id} />}
    </>
  );
}
