import { randomUUID } from 'node:crypto';
import { normalizeLessonKind } from './lesson-rules.mjs';
import {
  PolicyError,
  validateGradeInput,
  validateAttendanceInput,
  validateReviewInput,
} from './policy.mjs';

export async function learningData(db, user) {
  // Отбираем учебные записи в SQL, чтобы не читать работы всего колледжа для одного студента.
  const student = user.role === 'student';
  const teacher = user.role === 'teacher';
  const taskWhere = student ? 'WHERE group_id=?' : teacher ? 'WHERE teacher_id=?' : '';
  const taskParams = student ? [user.groupId] : teacher ? [user.id] : [];
  const workWhere = student ? 'WHERE s.student_id=?' : teacher ? 'WHERE a.teacher_id=?' : '';
  const markWhere = student ? 'WHERE m.student_id=?' : teacher ? 'WHERE l.teacher_id=?' : '';
  const ownParams = student || teacher ? [user.id] : [];
  const materialWhere = student
    ? 'WHERE subject_id IN (SELECT subject_id FROM school_teaching_assignments WHERE group_id=?)'
    : teacher
      ? 'WHERE subject_id IN (SELECT subject_id FROM school_teaching_assignments WHERE teacher_id=?)'
      : '';
  const [assignments, submissions, grades, attendance, materials, announcements] =
    await Promise.all([
      db
        .prepare(`SELECT * FROM school_assignments ${taskWhere} ORDER BY due_at,id`)
        .all(...taskParams),
      db
        .prepare(
          `SELECT s.*, f.name AS file_name, f.mime_type, f.bytes FROM school_submissions s
      JOIN school_files f ON f.id=s.file_id JOIN school_assignments a ON a.id=s.assignment_id
      ${workWhere} ORDER BY s.submitted_at,s.id`,
        )
        .all(...ownParams),
      db
        .prepare(
          `SELECT m.lesson_id AS "lessonId",m.student_id AS "studentId",m.grade,m.status,m.version
      FROM school_grades m JOIN school_lessons l ON l.id=m.lesson_id ${markWhere}`,
        )
        .all(...ownParams),
      db
        .prepare(
          `SELECT m.lesson_id AS "lessonId",m.student_id AS "studentId",m.status
      FROM school_attendance m JOIN school_lessons l ON l.id=m.lesson_id ${markWhere}`,
        )
        .all(...ownParams),
      db
        .prepare(
          `SELECT id,subject_id AS "subjectId",title,file_id AS "fileId" FROM school_materials
      ${materialWhere} ORDER BY title,id`,
        )
        .all(...taskParams),
      db
        .prepare(
          'SELECT id,title,body,published_at AS "publishedAt" FROM school_announcements ORDER BY published_at DESC,id',
        )
        .all(),
    ]);
  return {
    assignments: assignments.map((row) => ({
      id: row.id,
      lessonId: row.lesson_id ?? null,
      subjectId: row.subject_id,
      groupId: row.group_id,
      teacherId: row.teacher_id,
      title: row.title,
      type: row.type,
      description: row.description,
      steps: JSON.parse(row.steps_json),
      dueAt: row.due_at,
      version: Number(row.version),
    })),
    submissions: submissions.map((row) => ({
      id: row.id,
      assignmentId: row.assignment_id,
      studentId: row.student_id,
      status: row.status,
      submittedAt: row.submitted_at,
      grade: row.grade,
      comment: row.comment,
      version: Number(row.version),
      file: {
        id: row.file_id,
        name: row.file_name,
        mimeType: row.mime_type,
        bytes: Number(row.bytes),
      },
    })),
    grades,
    attendance,
    materials,
    announcements,
  };
}

// Dependencies come from the authentication store so all records share one
// database connection/transaction and current server-verified user identity.
export function createLearningStore({
  database,
  transaction,
  AuthError,
  publicUser,
  checkFields,
  checkVersion,
  lessonDate,
  hashPassword,
  validatePassword,
  normalizeName,
  normalizeEmail,
  demoAccountFlag,
  validateLessonAssignment,
}) {
  const deny = () => {
    throw new AuthError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия.');
  };
  const missing = () => {
    throw new AuthError(404, 'NOT_FOUND', 'Запись не найдена. Обновите страницу.');
  };
  async function currentUser(db, actor) {
    const row =
      actor?.id &&
      (await db
        .prepare('SELECT id,name,email,role,group_id,version FROM auth_users WHERE id=?')
        .get(actor.id));
    if (!row) throw new AuthError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт.');
    return publicUser(row);
  }
  function policy(action) {
    try {
      return action();
    } catch (error) {
      if (error instanceof PolicyError)
        throw new AuthError(
          error.status,
          error.body.error.code,
          error.body.error.message,
          error.body.error.fields,
        );
      throw error;
    }
  }
  async function requireTeaching(db, user, record) {
    if (!record) return missing();
    if (
      ![record.teacher_id, record.group_id, record.subject_id].every(
        (id) => typeof id === 'string' && id.length > 0 && id.length <= 100,
      )
    ) {
      throw new AuthError(
        422,
        'INVALID_REFERENCE',
        'Выберите корректные группу, предмет и преподавателя.',
      );
    }
    if (
      user.role !== 'teacher' ||
      record.teacher_id !== user.id ||
      !(await db
        .prepare(
          `SELECT 1 FROM school_teaching_assignments
      WHERE teacher_id=? AND group_id=? AND subject_id=?`,
        )
        .get(user.id, record.group_id, record.subject_id))
    )
      return deny();
  }
  async function lessonForMarks(db, user, lessonId) {
    const lesson = await db.prepare('SELECT * FROM school_lessons WHERE id=?').get(lessonId);
    await requireTeaching(db, user, lesson);
    if (lesson.kind === 'srsp') {
      throw new AuthError(
        422,
        'SRSP_NO_ATTENDANCE',
        'СРСП оценивается через связанную работу, без отдельной отметки присутствия.',
      );
    }
    if (lesson.status === 'cancelled' || Date.parse(lesson.starts_at) > Date.now()) {
      throw new AuthError(
        422,
        'LESSON_NOT_STARTED',
        'Оценки и посещаемость доступны только для начавшихся, не отменённых занятий.',
      );
    }
    return lesson;
  }
  async function requireStudent(db, studentId, groupId) {
    if (
      !(await db
        .prepare("SELECT 1 FROM auth_users WHERE id=? AND role='student' AND group_id=?")
        .get(studentId, groupId))
    ) {
      throw new AuthError(422, 'INVALID_STUDENT', 'Студент не состоит в группе занятия.');
    }
  }
  function text(value, maximum, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
      throw new AuthError(
        422,
        'INVALID_TEXT',
        `${label}: заполните поле (до ${maximum} символов).`,
      );
    }
    return value.trim();
  }

  async function saveGrade(actor, lessonId, studentId, input) {
    checkFields(input, ['grade', 'status', 'version']);
    const value = policy(() => validateGradeInput(input));
    return await transaction(async (db) => {
      const lesson = await lessonForMarks(db, await currentUser(db, actor), lessonId);
      await requireStudent(db, studentId, lesson.group_id);
      const old = await db
        .prepare('SELECT grade,version FROM school_grades WHERE lesson_id=? AND student_id=?')
        .get(lessonId, studentId);
      if (old && value.version === null)
        throw new AuthError(409, 'VERSION_CONFLICT', 'Оценка уже изменилась. Обновите журнал.');
      if (old) checkVersion(old, value.version);
      else if (value.version !== null)
        throw new AuthError(409, 'VERSION_CONFLICT', 'Оценка уже изменилась. Обновите журнал.');
      await db
        .prepare(
          `INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES (?,?,?,?)
        ON CONFLICT(lesson_id,student_id) DO UPDATE SET grade=excluded.grade,status=excluded.status,version=school_grades.version+1`,
        )
        .run(lessonId, studentId, value.grade, value.status);
      // Посещаемость тоже меняет отметки: открытая до правки старая форма должна получить 409.
      await db
        .prepare('UPDATE school_lessons SET attendance_version=attendance_version+1 WHERE id=?')
        .run(lessonId);
      return { ok: true };
    });
  }

  async function saveAttendance(actor, lessonId, input) {
    checkFields(input, ['entries', 'version']);
    return await transaction(async (db) => {
      const lesson = await lessonForMarks(db, await currentUser(db, actor), lessonId);
      const students = (
        await db
          .prepare("SELECT id FROM auth_users WHERE role='student' AND group_id=?")
          .all(lesson.group_id)
      ).map((row) => row.id);
      const value = policy(() => validateAttendanceInput(input, students));
      checkVersion({ version: lesson.attendance_version }, value.version);
      for (const entry of value.entries) {
        if (entry.status === null)
          await db
            .prepare('DELETE FROM school_attendance WHERE lesson_id=? AND student_id=?')
            .run(lessonId, entry.studentId);
        else
          await db
            .prepare(
              `INSERT INTO school_attendance(lesson_id,student_id,status) VALUES (?,?,?)
          ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status`,
            )
            .run(lessonId, entry.studentId, entry.status);
        // НП означает «оценка не предусмотрена», поэтому посещаемость её не меняет.
        if (entry.status === 'absent' || entry.status === 'excused') {
          await db
            .prepare(
              `INSERT INTO school_grades(lesson_id,student_id,grade,status) VALUES (?,?,NULL,?)
              ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,version=school_grades.version+1
              WHERE school_grades.grade IS NULL AND school_grades.status = 'unmarked'`,
            )
            .run(lessonId, entry.studentId, 'absent');
        } else {
          await db
            .prepare(
              "UPDATE school_grades SET status='unmarked',version=version+1 WHERE lesson_id=? AND student_id=? AND status='absent'",
            )
            .run(lessonId, entry.studentId);
        }
      }
      await db
        .prepare('UPDATE school_lessons SET attendance_version=attendance_version+1 WHERE id=?')
        .run(lessonId);
      return { ok: true };
    });
  }

  async function reviewSubmission(actor, id, input) {
    checkFields(input, ['action', 'grade', 'comment', 'version']);
    const value = policy(() => validateReviewInput(input));
    return await transaction(async (db) => {
      const user = await currentUser(db, actor);
      const work = await db.prepare('SELECT * FROM school_submissions WHERE id=?').get(id);
      if (!work) return missing();
      const assignment = await db
        .prepare('SELECT * FROM school_assignments WHERE id=?')
        .get(work.assignment_id);
      await requireTeaching(db, user, assignment);
      await requireStudent(db, work.student_id, assignment.group_id);
      checkVersion(work, value.version);
      await db
        .prepare(
          'UPDATE school_submissions SET status=?,grade=?,comment=?,version=version+1 WHERE id=?',
        )
        .run(value.status, value.grade, value.comment, id);
      return { ok: true };
    });
  }

  async function saveAssignment(actor, input) {
    checkFields(input, [
      'subjectId',
      'groupId',
      'teacherId',
      'title',
      'type',
      'description',
      'steps',
      'dueAt',
      'lessonId',
    ]);
    const title = text(input.title, 120, 'Название');
    const description = text(input.description, 3000, 'Условия');
    if (
      !Array.isArray(input.steps) ||
      input.steps.length > 50 ||
      input.steps.some((step) => typeof step !== 'string' || step.length > 500) ||
      input.steps.join('\n').length > 3000
    ) {
      throw new AuthError(
        422,
        'INVALID_STEPS',
        'Укажите до 50 этапов, не более 3000 символов суммарно.',
      );
    }
    const steps = input.steps.map((step) => step.trim()).filter(Boolean);
    const dueAt = lessonDate(input.dueAt, 'dueAt');
    if (Date.parse(dueAt) <= Date.now())
      throw new AuthError(422, 'INVALID_DEADLINE', 'Выберите будущий срок сдачи.');
    return await transaction(async (db) => {
      const user = await currentUser(db, actor);
      await requireTeaching(db, user, {
        teacher_id: input.teacherId,
        group_id: input.groupId,
        subject_id: input.subjectId,
      });
      if (typeof input.lessonId !== 'string' || !input.lessonId || input.lessonId.length > 100) {
        throw new AuthError(422, 'LESSON_REQUIRED', 'Выберите занятие для задания.', {
          lessonId: 'Выберите занятие.',
        });
      }
      const lesson = await db
        .prepare('SELECT * FROM school_lessons WHERE id=?')
        .get(input.lessonId);
      await requireTeaching(db, user, lesson);
      if (lesson.group_id !== input.groupId || lesson.subject_id !== input.subjectId) {
        throw new AuthError(
          422,
          'LESSON_MISMATCH',
          'Группа и предмет задания должны совпадать с занятием.',
        );
      }
      let type;
      try {
        type = normalizeLessonKind(lesson.kind);
        if (input.type !== undefined && normalizeLessonKind(input.type) !== type)
          throw new RangeError();
      } catch {
        throw new AuthError(422, 'INVALID_KIND', 'Тип задания определяется выбранным занятием.');
      }
      let source = lesson;
      if (type === 'srsp') {
        source = await db
          .prepare('SELECT * FROM school_lessons WHERE id=?')
          .get(lesson.practice_id);
        if (
          !source ||
          !['practice', 'Практика', 'Практическая работа', 'Лабораторная работа'].includes(
            source.kind,
          ) ||
          source.group_id !== lesson.group_id ||
          source.subject_id !== lesson.subject_id
        ) {
          throw new AuthError(
            422,
            'INVALID_PRACTICE',
            'Для СРСП нужна связанная практика той же группы и предмета.',
          );
        }
      }
      if (lesson.status !== 'scheduled' || source.status !== 'scheduled') {
        throw new AuthError(
          422,
          'LESSON_CANCELLED',
          'Нельзя публиковать задание для отменённого занятия.',
        );
      }
      const date = new Date(Date.parse(source.starts_at) + 5 * 3600000).toISOString().slice(0, 10);
      await validateLessonAssignment(
        db,
        {
          teacherId: user.id,
          groupId: lesson.group_id,
          subjectId: lesson.subject_id,
        },
        date,
      );
      await db
        .prepare(
          `INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          input.subjectId,
          input.groupId,
          user.id,
          title,
          type,
          description,
          JSON.stringify(steps),
          dueAt,
          lesson.id,
        );
      return { ok: true };
    });
  }

  async function readLearningFile(actor, id) {
    const db = await database(),
      user = await currentUser(db, actor);
    const file = await db.prepare('SELECT * FROM school_files WHERE id=?').get(id);
    if (!file) return missing();
    let allowed = user.role === 'admin';
    const works = await db
      .prepare(
        `SELECT s.student_id,a.group_id,a.subject_id,a.teacher_id FROM school_submissions s
      JOIN school_assignments a ON a.id=s.assignment_id WHERE s.file_id=?`,
      )
      .all(id);
    for (const work of works) {
      if (user.role === 'student' && work.student_id === user.id && work.group_id === user.groupId)
        allowed = true;
      if (
        user.role === 'teacher' &&
        work.teacher_id === user.id &&
        (await db
          .prepare(
            `SELECT 1 FROM school_teaching_assignments
        WHERE teacher_id=? AND group_id=? AND subject_id=?`,
          )
          .get(user.id, work.group_id, work.subject_id))
      )
        allowed = true;
    }
    if (!allowed) {
      const materials = await db
        .prepare('SELECT subject_id FROM school_materials WHERE file_id=?')
        .all(id);
      for (const material of materials) {
        if (user.role === 'teacher') {
          allowed = !!(await db
            .prepare(
              'SELECT 1 FROM school_teaching_assignments WHERE teacher_id=? AND subject_id=?',
            )
            .get(user.id, material.subject_id));
        } else if (user.role === 'student') {
          allowed = !!(await db
            .prepare('SELECT 1 FROM school_teaching_assignments WHERE group_id=? AND subject_id=?')
            .get(user.groupId, material.subject_id));
        }
        if (allowed) break;
      }
    }
    if (!allowed) return deny();
    return { name: file.name, mimeType: file.mime_type, bytes: new Uint8Array(file.contents) };
  }

  function validatedFile(file) {
    const name =
      typeof file?.name === 'string'
        ? file.name
            .split(/[\\/]/)
            .at(-1)
            .replace(/[\u0000-\u001f\u007f]/gu, '')
        : '';
    const extension = name.split('.').at(-1).toLowerCase();
    const types = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      zip: 'application/zip',
      sql: 'text/plain',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    };
    if (
      !name ||
      name.length > 120 ||
      !Object.hasOwn(types, extension) ||
      !(file.bytes instanceof Uint8Array) ||
      !file.bytes.length ||
      file.bytes.length > 3 * 1024 * 1024
    ) {
      throw new AuthError(
        422,
        'INVALID_FILE',
        'Выберите непустой PDF, DOCX, ZIP, SQL, TXT или изображение до 3 МБ. Имя — до 120 символов.',
      );
    }
    const bytes = Buffer.from(file.bytes);
    const hasPrefix = (values) => values.every((value, index) => bytes[index] === value);
    let valid = true;
    if (extension === 'pdf') valid = bytes.subarray(0, 5).toString() === '%PDF-';
    else if (extension === 'png') valid = hasPrefix([137, 80, 78, 71, 13, 10, 26, 10]);
    else if (['jpg', 'jpeg'].includes(extension)) valid = hasPrefix([255, 216, 255]);
    else if (['zip', 'docx'].includes(extension)) valid = hasPrefix([80, 75, 3, 4]);
    else {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        valid = false;
      }
    }
    if (!valid)
      throw new AuthError(
        422,
        'INVALID_FILE_CONTENT',
        'Содержимое файла не соответствует выбранному формату.',
      );
    return { name, mimeType: types[extension], bytes };
  }

  async function saveSubmission(actor, assignmentId, file) {
    const uploaded = validatedFile(file);
    return await transaction(async (db) => {
      const user = await currentUser(db, actor);
      const assignment = await db
        .prepare('SELECT * FROM school_assignments WHERE id=?')
        .get(assignmentId);
      if (!assignment) return missing();
      if (user.role !== 'student' || !user.groupId || user.groupId !== assignment.group_id)
        return deny();
      const old = await db
        .prepare('SELECT * FROM school_submissions WHERE assignment_id=? AND student_id=?')
        .get(assignmentId, user.id);
      if (old?.status === 'reviewed')
        throw new AuthError(409, 'ALREADY_REVIEWED', 'Преподаватель уже оценил эту работу.');
      const fileId = randomUUID();
      await db
        .prepare('INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES (?,?,?,?,?)')
        .run(fileId, uploaded.name, uploaded.mimeType, uploaded.bytes, uploaded.bytes.length);
      if (old)
        await db
          .prepare(
            "UPDATE school_submissions SET file_id=?,status='submitted',submitted_at=?,grade=NULL,comment='',version=version+1 WHERE id=?",
          )
          .run(fileId, new Date().toISOString(), old.id);
      else
        await db
          .prepare(
            "INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at) VALUES (?,?,?,?,'submitted',?)",
          )
          .run(randomUUID(), assignmentId, user.id, fileId, new Date().toISOString());
      if (
        old &&
        !(await db.prepare('SELECT 1 FROM school_submissions WHERE file_id=?').get(old.file_id)) &&
        !(await db.prepare('SELECT 1 FROM school_materials WHERE file_id=?').get(old.file_id))
      ) {
        await db.prepare('DELETE FROM school_files WHERE id=?').run(old.file_id);
      }
      return { ok: true };
    });
  }

  async function saveMaterial(actor, input, file) {
    checkFields(input, ['title', 'subjectId']);
    const title = text(input.title, 120, 'Название материала');
    const subjectId = text(input.subjectId, 100, 'Предмет');
    const uploaded = validatedFile(file);
    return await transaction(async (db) => {
      const user = await currentUser(db, actor);
      if (
        user.role !== 'teacher' ||
        !(await db
          .prepare('SELECT 1 FROM school_teaching_assignments WHERE teacher_id=? AND subject_id=?')
          .get(user.id, subjectId))
      )
        return deny();
      const fileId = randomUUID();
      await db
        .prepare('INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES (?,?,?,?,?)')
        .run(fileId, uploaded.name, uploaded.mimeType, uploaded.bytes, uploaded.bytes.length);
      await db
        .prepare('INSERT INTO school_materials(id,subject_id,title,file_id) VALUES (?,?,?,?)')
        .run(randomUUID(), subjectId, title, fileId);
      return { ok: true };
    });
  }

  async function deleteMaterial(actor, id) {
    return await transaction(async (db) => {
      const user = await currentUser(db, actor);
      const material = await db
        .prepare('SELECT subject_id,file_id FROM school_materials WHERE id=?')
        .get(id);
      if (!material) return missing();
      if (
        user.role !== 'admin' &&
        !(
          user.role === 'teacher' &&
          (await db
            .prepare(
              'SELECT 1 FROM school_teaching_assignments WHERE teacher_id=? AND subject_id=?',
            )
            .get(user.id, material.subject_id))
        )
      )
        return deny();
      await db.prepare('DELETE FROM school_materials WHERE id=?').run(id);
      if (
        !(await db
          .prepare('SELECT 1 FROM school_materials WHERE file_id=?')
          .get(material.file_id)) &&
        !(await db
          .prepare('SELECT 1 FROM school_submissions WHERE file_id=?')
          .get(material.file_id))
      ) {
        await db.prepare('DELETE FROM school_files WHERE id=?').run(material.file_id);
      }
      return { ok: true };
    });
  }

  async function saveAnnouncement(actor, input) {
    checkFields(input, ['title', 'body']);
    const title = text(input.title, 120, 'Заголовок');
    const body = text(input.body, 3000, 'Текст объявления');
    return await transaction(async (db) => {
      if ((await currentUser(db, actor)).role !== 'admin') return deny();
      await db
        .prepare('INSERT INTO school_announcements(id,title,body,published_at) VALUES (?,?,?,?)')
        .run(randomUUID(), title, body, new Date().toISOString());
      return { ok: true };
    });
  }

  async function deleteAnnouncement(actor, id) {
    return await transaction(async (db) => {
      if ((await currentUser(db, actor)).role !== 'admin') return deny();
      if (!(await db.prepare('SELECT 1 FROM school_announcements WHERE id=?').get(id)))
        return missing();
      await db.prepare('DELETE FROM school_announcements WHERE id=?').run(id);
      return { ok: true };
    });
  }

  async function seedDemoDataset(snapshot, passwordsByUserId) {
    const seedId = snapshot.seedId || 'studyhub-fictional-demo-v1';
    if (
      !['studyhub-fictional-demo-v1', 'studyhub-fictional-demo-v2', 'studyhub-campus-v3'].includes(
        seedId,
      )
    ) {
      throw new Error('Unknown demonstration data package');
    }
    const idPrefix =
      seedId === 'studyhub-campus-v3'
        ? 'demo-campus-'
        : seedId.endsWith('-v2')
          ? 'demo-more-'
          : 'demo-';
    const db = await database();
    const existing = await db
      .prepare('SELECT counts_json FROM school_demo_seeds WHERE id=?')
      .get(seedId);
    if (existing) return { created: false, counts: JSON.parse(existing.counts_json) };
    const data = snapshot.data;
    const demoEnabled = await demoAccountFlag(db);
    const users = data.users.filter((user) => user.role !== 'admin' || demoEnabled);
    for (const key of [
      'users',
      'groups',
      'subjects',
      'rooms',
      'lessons',
      'assignments',
      'submissions',
      'materials',
      'announcements',
    ]) {
      if (
        !Array.isArray(data[key]) ||
        data[key].some((row) => typeof row.id !== 'string' || !row.id.startsWith(idPrefix))
      )
        throw new Error('Demo seed requires IDs belonging to its package');
    }
    const passwordHashes = new Map();
    for (const user of users) {
      if (
        !['teacher', 'student'].includes(user.role) &&
        !(user.role === 'admin' && user.id === 'demo-admin' && demoEnabled)
      ) {
        throw new Error('Учебный администратор разрешён только в отдельной учебной базе');
      }
      passwordHashes.set(user.id, await hashPassword(validatePassword(passwordsByUserId[user.id])));
    }
    const counts = Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, key === 'users' ? users.length : value.length]),
    );
    try {
      return await transaction(async (db) => {
        const alreadyApplied = await db
          .prepare('SELECT counts_json FROM school_demo_seeds WHERE id=?')
          .get(seedId);
        if (alreadyApplied)
          return { created: false, counts: JSON.parse(alreadyApplied.counts_json) };
        for (const user of users)
          await db
            .prepare(
              'INSERT INTO auth_users(id,name,email,role,password_hash,created_at,is_demo) VALUES (?,?,?,?,?,?,1)',
            )
            .run(
              user.id,
              normalizeName(user.name),
              normalizeEmail(user.email),
              user.role,
              passwordHashes.get(user.id),
              Date.now(),
            );
        for (const group of data.groups)
          await db
            .prepare(
              'INSERT INTO school_groups(id,name,name_key,course,curator_id,version) VALUES (?,?,?,?,?,?)',
            )
            .run(
              group.id,
              normalizeName(group.name),
              normalizeName(group.name).normalize('NFC').toLocaleLowerCase('ru'),
              group.course,
              group.curatorId,
              group.version,
            );
        for (const user of users)
          if (user.groupId)
            await db
              .prepare('UPDATE auth_users SET group_id=? WHERE id=?')
              .run(user.groupId, user.id);
        for (const subject of data.subjects)
          await db
            .prepare('INSERT INTO school_subjects(id,name,name_key,version) VALUES (?,?,?,?)')
            .run(
              subject.id,
              normalizeName(subject.name),
              normalizeName(subject.name).normalize('NFC').toLocaleLowerCase('ru'),
              subject.version,
            );
        for (const room of data.rooms)
          await db
            .prepare(
              'INSERT INTO school_rooms(id,name,name_key,capacity,version) VALUES (?,?,?,?,?)',
            )
            .run(
              room.id,
              normalizeName(room.name),
              normalizeName(room.name).normalize('NFC').toLocaleLowerCase('ru'),
              room.capacity,
              room.version,
            );
        for (const pair of data.teachingAssignments)
          await db
            .prepare(
              'INSERT INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES (?,?,?)',
            )
            .run(pair.teacherId, pair.groupId, pair.subjectId);
        for (const lesson of data.lessons) {
          const startsAt = lessonDate(lesson.startsAt, 'startsAt');
          const endsAt = lessonDate(lesson.endsAt, 'endsAt');
          if (endsAt <= startsAt)
            throw new AuthError(422, 'INVALID_INTERVAL', 'Некорректный интервал учебного занятия.');
          if (
            lesson.status !== 'cancelled' &&
            (await db
              .prepare(
                `SELECT id FROM school_lessons WHERE status='scheduled'
            AND starts_at < ? AND ends_at > ? AND (group_id=? OR teacher_id=? OR room_id=?) LIMIT 1`,
              )
              .get(endsAt, startsAt, lesson.groupId, lesson.teacherId, lesson.roomId))
          ) {
            throw new AuthError(
              409,
              'DEMO_SCHEDULE_CONFLICT',
              'Расписание изменилось: пример пересекается с существующим занятием. Повторите заполнение.',
            );
          }
          await db
            .prepare(
              `INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,note,version,attendance_version)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              lesson.id,
              lesson.groupId,
              lesson.subjectId,
              lesson.teacherId,
              lesson.roomId,
              startsAt,
              endsAt,
              lesson.kind,
              lesson.status,
              lesson.note,
              lesson.version,
              lesson.attendanceVersion,
            );
        }
        for (const [id, file] of Object.entries(snapshot.files)) {
          if (!id.startsWith(idPrefix)) throw new Error('Demo file IDs must belong to its package');
          const validated = validatedFile({ ...file, bytes: new TextEncoder().encode(file.text) });
          await db
            .prepare(
              'INSERT INTO school_files(id,name,mime_type,contents,bytes) VALUES (?,?,?,?,?)',
            )
            .run(id, validated.name, validated.mimeType, validated.bytes, validated.bytes.length);
        }
        for (const task of data.assignments)
          await db
            .prepare(
              `INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,version)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              task.id,
              task.subjectId,
              task.groupId,
              task.teacherId,
              task.title,
              task.type,
              task.description,
              JSON.stringify(task.steps),
              lessonDate(task.dueAt, 'dueAt'),
              task.version,
            );
        for (const work of data.submissions)
          await db
            .prepare(
              `INSERT INTO school_submissions(id,assignment_id,student_id,file_id,status,submitted_at,grade,comment,version)
          VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              work.id,
              work.assignmentId,
              work.studentId,
              work.file.id,
              work.status,
              lessonDate(work.submittedAt, 'submittedAt'),
              work.grade,
              work.comment,
              work.version,
            );
        for (const grade of data.grades)
          await db
            .prepare(
              'INSERT INTO school_grades(lesson_id,student_id,grade,status,version) VALUES (?,?,?,?,?)',
            )
            .run(
              grade.lessonId,
              grade.studentId,
              grade.grade,
              grade.status ?? (grade.grade === null ? 'unmarked' : 'graded'),
              grade.version,
            );
        for (const mark of data.attendance)
          await db
            .prepare('INSERT INTO school_attendance(lesson_id,student_id,status) VALUES (?,?,?)')
            .run(mark.lessonId, mark.studentId, mark.status);
        for (const material of data.materials)
          await db
            .prepare('INSERT INTO school_materials(id,subject_id,title,file_id) VALUES (?,?,?,?)')
            .run(material.id, material.subjectId, material.title, material.fileId);
        for (const notice of data.announcements)
          await db
            .prepare(
              'INSERT INTO school_announcements(id,title,body,published_at) VALUES (?,?,?,?)',
            )
            .run(
              notice.id,
              notice.title,
              notice.body,
              lessonDate(notice.publishedAt, 'publishedAt'),
            );
        await db
          .prepare(
            'INSERT INTO school_demo_seeds(id,seed_date,counts_json,created_at) VALUES (?,?,?,?)',
          )
          .run(seedId, snapshot.seedDate, JSON.stringify(counts), Date.now());
        return { created: true, counts };
      });
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /constraint|unique/i.test(error.message)) {
        throw new AuthError(
          409,
          'DEMO_COLLISION',
          'Учебные записи пересекаются с существующими записями. Ничего не изменено.',
        );
      }
      throw error;
    }
  }

  return {
    saveGrade,
    saveAttendance,
    reviewSubmission,
    saveAssignment,
    readLearningFile,
    saveSubmission,
    seedDemoDataset,
    saveMaterial,
    deleteMaterial,
    saveAnnouncement,
    deleteAnnouncement,
  };
}
