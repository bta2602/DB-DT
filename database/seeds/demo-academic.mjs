import { campusDate, lessonPeriod } from '../../lib/studyhub/lesson-rules.mjs';
import { CAMPUS_SEED_ID } from './campus-data.mjs';

export const demoAcademicMetadataKey = 'demo_academic_metadata_v1';

// Exact IDs owned by the base demo and campus-v3 packages, never arbitrary demo-* records.
const groupIds = new Set([
  'demo-group-1',
  'demo-group-2',
  ...Array.from({ length: 14 }, (_, index) => `demo-campus-group-${index + 1}`),
]);
const teacherIds = new Set([
  'demo-teacher-1',
  'demo-teacher-2',
  'demo-teacher-3',
  ...Array.from({ length: 13 }, (_, index) => `demo-campus-teacher-${index + 1}`),
]);
const subjectIds = new Set([
  'demo-subject-db',
  'demo-subject-web',
  'demo-subject-math',
  'demo-subject-design',
  ...Array.from({ length: 8 }, (_, index) => `demo-campus-subject-${index + 1}`),
]);

async function insertRows(db, table, columns, rows) {
  let changes = 0;
  for (let offset = 0; offset < rows.length; offset += 250) {
    const batch = rows.slice(offset, offset + 250);
    const placeholders = batch.map((row) => `(${row.map(() => '?').join(',')})`).join(',');
    const result = await db
      .prepare(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      )
      .run(...batch.flat());
    changes += result.changes;
  }
  return changes;
}

/** Complete missing academic setup of the standard fictional campus, once and additively.
 * The existing runtime transaction serializes this repair with normal application writes.
 */
export async function completeDemoAcademicMetadata(db) {
  return db.transaction(async (tx) => {
    const guard = await tx
      .prepare(
        `SELECT
          EXISTS(SELECT 1 FROM studyhub_settings WHERE key='dataset_mode' AND value='demo') AS demo,
          EXISTS(SELECT 1 FROM school_demo_seeds WHERE id=?) AS campus,
          EXISTS(SELECT 1 FROM auth_users WHERE is_demo=0) AS ordinary,
          EXISTS(SELECT 1 FROM studyhub_settings WHERE key=?) AS completed`,
      )
      .get(CAMPUS_SEED_ID, demoAcademicMetadataKey);
    if (!guard.demo || !guard.campus || guard.ordinary) {
      throw new Error(
        'Учебные связи можно дополнить только в стандартной синтетической базе кампуса без обычных аккаунтов.',
      );
    }
    const counts = { groupLanguages: 0, teacherSubjects: 0, teacherLanguages: 0, groupSubjects: 0 };
    const skipped = { teacherSubjects: 0, teacherLanguages: 0, curricula: 0, subjectLimit: 0 };
    if (guard.completed) return { applied: false, counts, skipped };

    const groups = await tx.prepare('SELECT id,language FROM school_groups').all();
    const teachers = await tx
      .prepare("SELECT id FROM auth_users WHERE role='teacher' AND is_demo=1")
      .all();
    const subjects = await tx.prepare('SELECT id FROM school_subjects').all();
    const pairs = await tx
      .prepare('SELECT teacher_id,group_id,subject_id FROM school_teaching_assignments')
      .all();
    const lessons = await tx
      .prepare(
        `SELECT l.group_id,l.subject_id,l.teacher_id,
           CASE WHEN TRIM(l.kind) IN ('srsp','СРСП') THEN p.starts_at ELSE l.starts_at END AS starts_at
           FROM school_lessons l LEFT JOIN school_lessons p ON p.id=l.practice_id
           WHERE l.status='scheduled' AND l.archived_at IS NULL
           AND (TRIM(l.kind) NOT IN ('srsp','СРСП') OR (p.status='scheduled' AND p.archived_at IS NULL
             AND p.group_id=l.group_id AND p.subject_id=l.subject_id
             AND TRIM(p.kind) IN ('practice','Практика','Практическая работа','Лабораторная работа')))`,
      )
      .all();
    const specialties = await tx
      .prepare('SELECT teacher_id,subject_id FROM school_teacher_subjects')
      .all();
    const languages = await tx
      .prepare('SELECT teacher_id,language FROM school_teacher_languages')
      .all();
    const curricula = await tx
      .prepare('SELECT group_id,subject_id,academic_year,semester FROM school_group_subjects')
      .all();
    const knownGroups = new Map(
      groups.filter((group) => groupIds.has(group.id)).map((group) => [group.id, group]),
    );
    const knownTeachers = teachers.filter((teacher) => teacherIds.has(teacher.id));
    const knownTeacherIds = new Set(knownTeachers.map((teacher) => teacher.id));
    const knownSubjectIds = new Set(
      subjects.filter((subject) => subjectIds.has(subject.id)).map((subject) => subject.id),
    );
    const knownPairs = pairs.filter(
      (pair) =>
        knownGroups.has(pair.group_id) &&
        knownTeacherIds.has(pair.teacher_id) &&
        knownSubjectIds.has(pair.subject_id),
    );
    const paired = new Set(
      knownPairs.map((pair) => `${pair.teacher_id}/${pair.group_id}/${pair.subject_id}`),
    );
    const subjectRows = [];
    const languageRows = [];
    for (const teacher of knownTeachers) {
      const assigned = knownPairs.filter((pair) => pair.teacher_id === teacher.id);
      const desiredSubjects = [...new Set(assigned.map((pair) => pair.subject_id))];
      if (specialties.some((row) => row.teacher_id === teacher.id)) {
        skipped.teacherSubjects++;
      } else if (desiredSubjects.length > 3) {
        skipped.subjectLimit++;
      } else {
        for (const subjectId of desiredSubjects) subjectRows.push([teacher.id, subjectId]);
      }
      if (languages.some((row) => row.teacher_id === teacher.id)) {
        skipped.teacherLanguages++;
      } else {
        const desiredLanguages = new Set(
          assigned.map((pair) => knownGroups.get(pair.group_id).language ?? 'ru'),
        );
        for (const language of desiredLanguages) languageRows.push([teacher.id, language]);
      }
    }
    const plannedCurricula = new Map();
    for (const lesson of lessons) {
      if (!paired.has(`${lesson.teacher_id}/${lesson.group_id}/${lesson.subject_id}`)) continue;
      let period;
      try {
        period = lessonPeriod(campusDate(lesson.starts_at));
      } catch {
        continue;
      }
      const { academicYear, semester } = period;
      const key = `${lesson.group_id}/${academicYear}/${semester}`;
      if (!plannedCurricula.has(key))
        plannedCurricula.set(key, {
          groupId: lesson.group_id,
          academicYear,
          semester,
          subjects: new Set(),
        });
      plannedCurricula.get(key).subjects.add(lesson.subject_id);
    }
    const curriculumRows = [];
    for (const curriculum of plannedCurricula.values()) {
      if (
        curricula.some(
          (row) =>
            row.group_id === curriculum.groupId &&
            Number(row.academic_year) === curriculum.academicYear &&
            Number(row.semester) === curriculum.semester,
        )
      ) {
        skipped.curricula++;
        continue;
      }
      for (const subjectId of curriculum.subjects) {
        curriculumRows.push([
          curriculum.groupId,
          subjectId,
          curriculum.academicYear,
          curriculum.semester,
        ]);
      }
    }
    counts.teacherSubjects = await insertRows(
      tx,
      'school_teacher_subjects',
      ['teacher_id', 'subject_id'],
      subjectRows,
    );
    counts.teacherLanguages = await insertRows(
      tx,
      'school_teacher_languages',
      ['teacher_id', 'language'],
      languageRows,
    );
    counts.groupSubjects = await insertRows(
      tx,
      'school_group_subjects',
      ['group_id', 'subject_id', 'academic_year', 'semester'],
      curriculumRows,
    );
    const unconfiguredGroups = [...knownGroups.values()]
      .filter((group) => group.language === null)
      .map((group) => group.id);
    if (unconfiguredGroups.length) {
      counts.groupLanguages = (
        await tx
          .prepare(
            `UPDATE school_groups SET language='ru',version=version+1 WHERE language IS NULL AND id IN (${unconfiguredGroups.map(() => '?').join(',')})`,
          )
          .run(...unconfiguredGroups)
      ).changes;
    }
    await tx
      .prepare('INSERT INTO studyhub_settings(key,value) VALUES (?,?)')
      .run(demoAcademicMetadataKey, JSON.stringify({ counts, skipped }));
    return { applied: true, counts, skipped };
  });
}
