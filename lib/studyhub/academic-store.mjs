import { campusDate, lessonInterval, lessonPeriod } from './lesson-rules.mjs';

export function createAcademicStore({
  database,
  transaction,
  AuthError,
  requireAdmin,
  reference,
  checkFields,
}) {
  const invalid = (code, message, field) => {
    throw new AuthError(422, code, message, field ? { [field]: message } : {});
  };
  const protectedChange = () => {
    throw new AuthError(
      409,
      'ACADEMIC_ASSIGNMENT_IN_USE',
      'Изменение нарушает назначения будущих занятий. Сначала измените расписание.',
    );
  };

  function period(date) {
    try {
      return lessonPeriod(date);
    } catch {
      return invalid('INVALID_DATE', 'Укажите корректную дату занятия.', 'date');
    }
  }

  async function validateAcademicAssignment(db, record, date, { requireAssignment = true } = {}) {
    const { teacherId, groupId, subjectId } = record;
    await reference(db, 'auth_users', teacherId, 'teacherId', 'преподавателя', 'teacher');
    await reference(db, 'school_groups', groupId, 'groupId', 'группу');
    await reference(db, 'school_subjects', subjectId, 'subjectId', 'предмет');
    const group = await db.prepare('SELECT language FROM school_groups WHERE id=?').get(groupId);
    if (!['kk', 'ru'].includes(group.language))
      invalid(
        'ACADEMIC_SETUP_REQUIRED',
        'Сначала настройте язык и учебный план группы.',
        'groupId',
      );
    if (
      !(await db
        .prepare('SELECT 1 FROM school_teacher_subjects WHERE teacher_id=? AND subject_id=?')
        .get(teacherId, subjectId))
    )
      invalid(
        'TEACHER_SUBJECT_NOT_ALLOWED',
        'Этот предмет не назначен преподавателю.',
        'teacherId',
      );
    if (
      !(await db
        .prepare('SELECT 1 FROM school_teacher_languages WHERE teacher_id=? AND language=?')
        .get(teacherId, group.language))
    )
      invalid(
        'TEACHER_LANGUAGE_NOT_ALLOWED',
        'Преподаватель не ведёт занятия на языке группы.',
        'teacherId',
      );
    const { academicYear, semester } = period(date);
    if (
      !(await db
        .prepare(
          'SELECT 1 FROM school_group_subjects WHERE group_id=? AND subject_id=? AND academic_year=? AND semester=?',
        )
        .get(groupId, subjectId, academicYear, semester))
    )
      invalid(
        'SUBJECT_NOT_IN_CURRICULUM',
        'Предмет отсутствует в учебном плане группы на этот семестр.',
        'subjectId',
      );
    if (
      requireAssignment &&
      !(await db
        .prepare(
          'SELECT 1 FROM school_teaching_assignments WHERE teacher_id=? AND group_id=? AND subject_id=?',
        )
        .get(teacherId, groupId, subjectId))
    )
      invalid(
        'TEACHING_ASSIGNMENT_REQUIRED',
        'Сначала назначьте преподавателя этой группе по предмету.',
        'teacherId',
      );
    return { academicYear, semester };
  }

  async function academicData(db) {
    const [teacherSubjects, teacherLanguages, groupSubjects] = await Promise.all([
      db
        .prepare(
          'SELECT teacher_id AS teacherId,subject_id AS subjectId FROM school_teacher_subjects ORDER BY teacher_id,subject_id',
        )
        .all(),
      db
        .prepare(
          'SELECT teacher_id AS teacherId,language FROM school_teacher_languages ORDER BY teacher_id,language',
        )
        .all(),
      db
        .prepare(
          'SELECT group_id AS groupId,subject_id AS subjectId,academic_year AS academicYear,semester FROM school_group_subjects ORDER BY group_id,academic_year,semester,subject_id',
        )
        .all(),
    ]);
    return { teacherSubjects, teacherLanguages, groupSubjects };
  }

  function list(value, max, field) {
    if (
      !Array.isArray(value) ||
      value.length > max ||
      value.some((item) => typeof item !== 'string' || !item || item.length > 100) ||
      new Set(value).size !== value.length
    )
      invalid('INVALID_ACADEMIC_LIST', 'Передайте список уникальных допустимых значений.', field);
    return value;
  }

  async function futureLessons(db) {
    return db
      .prepare(
        `SELECT l.*,g.language,COALESCE(l.starts_at,p.starts_at) AS effective_start
      FROM school_lessons l JOIN school_groups g ON g.id=l.group_id
      LEFT JOIN school_lessons p ON p.id=l.practice_id
      WHERE l.status='scheduled' AND (l.kind<>'srsp' OR (p.status='scheduled' AND p.kind IN ('practice','Практика','Практическая работа','Лабораторная работа')))
      AND COALESCE(l.ends_at,p.ends_at)>?`,
      )
      .all(new Date().toISOString());
  }

  async function saveAcademicConfig(actor, kind, input) {
    const allowed = {
      'teacher-subjects': ['teacherId', 'subjectIds'],
      'teacher-languages': ['teacherId', 'languages'],
      'group-subjects': ['groupId', 'academicYear', 'semester', 'subjectIds'],
    };
    if (!Object.hasOwn(allowed, kind))
      throw new AuthError(404, 'NOT_FOUND', 'Настройка не найдена.');
    checkFields(input, allowed[kind]);
    return transaction(async (db) => {
      await requireAdmin(db, actor);
      const future = await futureLessons(db);
      if (kind === 'group-subjects') {
        const groupId = await reference(db, 'school_groups', input.groupId, 'groupId', 'группу');
        const subjectIds = list(input.subjectIds, 100, 'subjectIds');
        if (
          !Number.isSafeInteger(input.academicYear) ||
          input.academicYear < 2000 ||
          input.academicYear > 9998 ||
          ![1, 2].includes(input.semester)
        )
          invalid('INVALID_ACADEMIC_PERIOD', 'Укажите учебный год и семестр.', 'academicYear');
        for (const subjectId of subjectIds)
          await reference(db, 'school_subjects', subjectId, 'subjectIds', 'предмет');
        if (
          future.some((lesson) => {
            const current = period(campusDate(lesson.effective_start));
            return (
              lesson.group_id === groupId &&
              current.academicYear === input.academicYear &&
              current.semester === input.semester &&
              !subjectIds.includes(lesson.subject_id)
            );
          })
        )
          protectedChange();
        await db
          .prepare(
            'DELETE FROM school_group_subjects WHERE group_id=? AND academic_year=? AND semester=?',
          )
          .run(groupId, input.academicYear, input.semester);
        for (const subjectId of subjectIds)
          await db
            .prepare(
              'INSERT INTO school_group_subjects(group_id,subject_id,academic_year,semester) VALUES (?,?,?,?)',
            )
            .run(groupId, subjectId, input.academicYear, input.semester);
      } else {
        const teacherId = await reference(
          db,
          'auth_users',
          input.teacherId,
          'teacherId',
          'преподавателя',
          'teacher',
        );
        if (kind === 'teacher-subjects') {
          const subjectIds = list(input.subjectIds, 3, 'subjectIds');
          for (const subjectId of subjectIds)
            await reference(db, 'school_subjects', subjectId, 'subjectIds', 'предмет');
          if (
            future.some(
              (lesson) =>
                lesson.teacher_id === teacherId && !subjectIds.includes(lesson.subject_id),
            )
          )
            protectedChange();
          await db.prepare('DELETE FROM school_teacher_subjects WHERE teacher_id=?').run(teacherId);
          for (const subjectId of subjectIds)
            await db
              .prepare('INSERT INTO school_teacher_subjects(teacher_id,subject_id) VALUES (?,?)')
              .run(teacherId, subjectId);
        } else {
          const languages = list(input.languages, 2, 'languages');
          if (languages.some((language) => !['kk', 'ru'].includes(language)))
            invalid('INVALID_LANGUAGE', 'Выберите kk или ru.', 'languages');
          if (
            future.some(
              (lesson) =>
                lesson.teacher_id === teacherId &&
                lesson.language &&
                !languages.includes(lesson.language),
            )
          )
            protectedChange();
          await db
            .prepare('DELETE FROM school_teacher_languages WHERE teacher_id=?')
            .run(teacherId);
          for (const language of languages)
            await db
              .prepare('INSERT INTO school_teacher_languages(teacher_id,language) VALUES (?,?)')
              .run(teacherId, language);
        }
      }
      return { ok: true };
    });
  }

  async function getRoomAvailability(actor, input) {
    checkFields(input, ['date', 'slotId', 'groupId', 'excludeLessonId']);
    const db = await database();
    const user =
      actor?.id &&
      (await db.prepare('SELECT id,role,group_id FROM auth_users WHERE id=?').get(actor.id));
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт.');
    await reference(db, 'school_groups', input.groupId, 'groupId', 'группу');
    const allowed =
      user.role === 'admin' ||
      (user.role === 'student' && user.group_id === input.groupId) ||
      (user.role === 'teacher' &&
        (await db
          .prepare(
            'SELECT 1 FROM school_teaching_assignments WHERE teacher_id=? AND group_id=? LIMIT 1',
          )
          .get(user.id, input.groupId)));
    if (!allowed) throw new AuthError(403, 'FORBIDDEN', 'Эта группа недоступна.');
    let interval;
    try {
      interval = lessonInterval(input.date, input.slotId);
    } catch (error) {
      invalid('INVALID_INTERVAL', error.message, 'slotId');
    }
    const exclude = input.excludeLessonId ?? '';
    if (typeof exclude !== 'string' || exclude.length > 100)
      invalid('INVALID_REFERENCE', 'Некорректный идентификатор занятия.', 'excludeLessonId');
    if (exclude) {
      await requireAdmin(db, user);
      await reference(db, 'school_lessons', exclude, 'excludeLessonId', 'занятие');
    }
    const [rooms, occupied, count] = await Promise.all([
      db.prepare('SELECT id,capacity FROM school_rooms ORDER BY name_key,id').all(),
      db
        .prepare(
          `SELECT room_id,MAX(ends_at) AS busy_until FROM school_lessons
        WHERE status='scheduled' AND kind<>'srsp' AND id<>? AND starts_at<? AND ends_at>?
        GROUP BY room_id`,
        )
        .all(exclude, interval.endsAt, interval.startsAt),
      db
        .prepare("SELECT COUNT(*) AS total FROM auth_users WHERE role='student' AND group_id=?")
        .get(input.groupId),
    ]);
    const busy = new Map(occupied.map((row) => [row.room_id, row.busy_until]));
    return {
      rooms: rooms.map((room) => ({
        roomId: room.id,
        available: !busy.has(room.id),
        capacityOk: room.capacity != null && Number(room.capacity) >= Number(count.total),
        busyUntil: busy.get(room.id) ?? null,
      })),
    };
  }

  return { validateAcademicAssignment, academicData, saveAcademicConfig, getRoomAvailability };
}
