import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { ACADEMIC_SLOTS, createAcademicPlan } from './academic-plan.mjs';

const deriveKey = promisify(scrypt);
const DAY = 86400000;
const OFFSET = 5 * 60 * 60 * 1000;
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const teacherNames = [
  'Алия Нурлановна Серикова',
  'Марат Садыкович Омаров',
  'Динара Ерлановна Асанова',
  'Дамир Канатович Кожахметов',
  'Елена Андреевна Миронова',
  'Санжар Болатович Сулейменов',
  'Мадина Армановна Бекенова',
  'Алексей Викторович Соколов',
  'Жанар Муратовна Нурбекова',
  'Арман Талгатович Турсунов',
  'Ольга Сергеевна Федорова',
  'Тимур Ермекович Жаксылыков',
  'Дана Куанышевна Ибраева',
  'Андрей Павлович Орлов',
  'Айгерим Нурлановна Тлеубекова',
  'Гульмира Асхатовна Жумабаева',
  'Ирина Михайловна Белова',
  'Руслан Даниярович Абдрахманов',
];
const kazakhFirstNames = [
  ['Айдана', 'Тимур'],
  ['Аружан', 'Данияр'],
  ['Әлия', 'Ерасыл'],
  ['Амина', 'Арман'],
  ['Салтанат', 'Руслан'],
  ['Мадина', 'Нұрислам'],
  ['Дана', 'Әділ'],
  ['Аяжан', 'Дамир'],
  ['Меруерт', 'Бекзат'],
  ['Динара', 'Нұрбек'],
  ['Кәмила', 'Әлішер'],
  ['Раяна', 'Ілияс'],
  ['Томирис', 'Азамат'],
  ['Әсел', 'Сұлтан'],
  ['Ақбота', 'Нұрсұлтан'],
  ['Айгерім', 'Мұрат'],
  ['Жансая', 'Әлихан'],
  ['Назерке', 'Еркебұлан'],
];
const kazakhFamilies = [
  ['Ахметова', 'Ахметов', 'Серікқызы', 'Серікұлы'],
  ['Омарова', 'Омаров', 'Ерланқызы', 'Ерланұлы'],
  ['Қасымова', 'Қасымов', 'Мұратқызы', 'Мұратұлы'],
  ['Есенова', 'Есенов', 'Талғатқызы', 'Талғатұлы'],
  ['Әбілова', 'Әбілов', 'Қанатқызы', 'Қанатұлы'],
  ['Исаева', 'Исаев', 'Арманқызы', 'Арманұлы'],
  ['Нұралиева', 'Нұралиев', 'Болатқызы', 'Болатұлы'],
  ['Садықова', 'Садықов', 'Асхатқызы', 'Асхатұлы'],
  ['Төлеубаева', 'Төлеубаев', 'Нұрланқызы', 'Нұрланұлы'],
  ['Қайратова', 'Қайратов', 'Даниярқызы', 'Даниярұлы'],
];

const russianFirstNames = [
  ['Алина', 'Александр'],
  ['Анна', 'Дмитрий'],
  ['Мария', 'Максим'],
  ['София', 'Артём'],
  ['Полина', 'Никита'],
  ['Дарья', 'Иван'],
  ['Екатерина', 'Михаил'],
  ['Анастасия', 'Андрей'],
  ['Виктория', 'Кирилл'],
  ['Елизавета', 'Даниил'],
  ['Александра', 'Роман'],
  ['Вероника', 'Илья'],
  ['Валерия', 'Егор'],
  ['Ксения', 'Матвей'],
  ['Алиса', 'Владислав'],
  ['Милана', 'Тимофей'],
  ['Ульяна', 'Павел'],
  ['Диана', 'Денис'],
];
const russianFamilies = [
  ['Иванова', 'Иванов', 'Сергеевна', 'Сергеевич'],
  ['Петрова', 'Петров', 'Андреевна', 'Андреевич'],
  ['Соколова', 'Соколов', 'Александровна', 'Александрович'],
  ['Смирнова', 'Смирнов', 'Дмитриевна', 'Дмитриевич'],
  ['Кузнецова', 'Кузнецов', 'Викторовна', 'Викторович'],
  ['Попова', 'Попов', 'Алексеевна', 'Алексеевич'],
  ['Волкова', 'Волков', 'Михайловна', 'Михайлович'],
  ['Морозова', 'Морозов', 'Николаевна', 'Николаевич'],
  ['Орлова', 'Орлов', 'Павловна', 'Павлович'],
  ['Фёдорова', 'Фёдоров', 'Игоревна', 'Игоревич'],
];

// Only new fictional accounts receive these names; existing names are never rewritten.
export function academicStudentName(index, language) {
  if (!Number.isInteger(index) || index < 0 || !['kk', 'ru'].includes(language))
    throw new RangeError('Укажите номер студента и язык группы kk или ru.');
  const firstNames = language === 'kk' ? kazakhFirstNames : russianFirstNames;
  const families = language === 'kk' ? kazakhFamilies : russianFamilies;
  const sex = index % 2;
  const first = firstNames[Math.floor(index / 2) % firstNames.length][sex];
  const family = families[Math.floor(index / (firstNames.length * 2)) % families.length];
  return `${first} ${family[sex + 2]} ${family[sex]}`;
}

function normalized(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replace(/\s*·\s*демо$/u, '')
    .trim();
}

function firstMonday(year) {
  const date = new Date(Date.UTC(year, 8, 1));
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  return date.toISOString().slice(0, 10);
}

export function datesForTerm(academicYear, startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('startDate: ожидается YYYY-MM-DD.');
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const date = new Date(start);
  if (
    !Number.isFinite(start) ||
    date.toISOString().slice(0, 10) !== startDate ||
    date.getUTCDay() === 0 ||
    date.getUTCDay() === 6
  )
    throw new Error('Начало расписания должно быть существующим будним днём.');
  const days = [];
  // A rollout may start midweek; keep twenty teaching days and skip every weekend.
  for (let offset = 0; days.length < 20; offset++) {
    const current = new Date(start + offset * DAY);
    if (current.getUTCDay() !== 0 && current.getUTCDay() !== 6)
      days.push(current.toISOString().slice(0, 10));
  }
  const finalDate = days.at(-1);
  // The shared backend contract treats January as semester 2.
  if (startDate < `${academicYear}-09-01` || finalDate > `${academicYear}-12-31`)
    throw new Error('Четыре недели должны находиться в первом семестре.');
  return Array.from({ length: 4 }, (_, week) => days.slice(week * 5, week * 5 + 5));
}

function requiredRoomTypes(subjectCode, kind) {
  if (kind === 'lecture') return ['lecture', 'ordinary'];
  if (['math', 'stats', 'english', 'projects'].includes(subjectCode))
    return ['ordinary', 'lecture'];
  if (['os', 'networks', 'security'].includes(subjectCode)) return ['laboratory'];
  return ['computer'];
}

async function counts(db) {
  const result = {};
  for (const [name, table, where] of [
    ['groups', 'school_groups', ''],
    ['students', 'auth_users', " WHERE role='student'"],
    ['teachers', 'auth_users', " WHERE role='teacher'"],
    ['subjects', 'school_subjects', ''],
    ['rooms', 'school_rooms', ''],
    ['lessons', 'school_lessons', ''],
  ])
    result[name] = Number(
      (await db.prepare(`SELECT count(*) AS count FROM ${table}${where}`).get()).count,
    );
  return result;
}

/** Explicit fixture fill; the caller selects an isolated database and applies the migration first.
 * Existing identities, memberships, credentials, lesson times and learning records are never removed.
 * onCredentials is awaited before commit, so the CLI can save new passwords privately or roll back.
 */
export async function seedAcademicData(
  db,
  { academicYear = 2026, startDate = firstMonday(academicYear), onCredentials } = {},
) {
  const plan = createAcademicPlan(academicYear);
  const weeks = datesForTerm(academicYear, startDate);
  const seedId = `studyhub-academic-v1-${academicYear}-semester-1`;
  return db.transaction(async (tx) => {
    const marker = await tx.prepare('SELECT 1 FROM school_demo_seeds WHERE id=?').get(seedId);
    if (marker) return { created: false, counts: await counts(tx), accounts: [], warnings: [] };

    const accounts = [];
    const warnings = [];
    const entities = {
      group: await tx.prepare('SELECT * FROM school_groups ORDER BY id').all(),
      subject: await tx.prepare('SELECT * FROM school_subjects ORDER BY id').all(),
      room: await tx.prepare('SELECT * FROM school_rooms ORDER BY id').all(),
      teacher: await tx.prepare("SELECT * FROM auth_users WHERE role='teacher' ORDER BY id").all(),
      student: await tx.prepare("SELECT * FROM auth_users WHERE role='student' ORDER BY id").all(),
    };
    const mappings = await tx.prepare('SELECT * FROM school_academic_seed_map').all();
    const map = new Map(mappings.map((row) => [`${row.entity}:${row.seed_key}`, row.record_id]));
    const used = new Set(mappings.map((row) => `${row.entity}:${row.record_id}`));
    const byId = Object.fromEntries(
      Object.entries(entities).map(([kind, rows]) => [
        kind,
        new Map(rows.map((row) => [row.id, row])),
      ]),
    );
    const mapped = (entity, key) => {
      const id = map.get(`${entity}:${key}`);
      if (!id) return null;
      const row = byId[entity].get(id);
      if (!row) throw new Error(`Нарушена карта учебного набора: ${entity}/${key}.`);
      return row;
    };
    const available = (entity) =>
      entities[entity].filter((row) => !used.has(`${entity}:${row.id}`));
    async function remember(entity, key, row) {
      await tx
        .prepare(
          'INSERT INTO school_academic_seed_map(entity,seed_key,record_id) VALUES (?,?,?) ON CONFLICT(entity,seed_key) DO NOTHING',
        )
        .run(entity, key, row.id);
      map.set(`${entity}:${key}`, row.id);
      used.add(`${entity}:${row.id}`);
      byId[entity].set(row.id, row);
      return row;
    }
    async function createAccount(role, key, name, groupId = null) {
      const id = `academic-${key}`;
      const email = `${key}@studyhub.example`;
      const password = randomBytes(24).toString('base64url');
      const salt = randomBytes(16);
      const hash = await deriveKey(password, salt, 64, SCRYPT);
      const passwordHash = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
      await tx
        .prepare(
          'INSERT INTO auth_users(id,email,name,password_hash,role,created_at,is_demo,group_id) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(id, email, name, passwordHash, role, Date.now(), 1, groupId);
      const account = { id, email, name, role, group_id: groupId };
      accounts.push({ id, email, name, role, password });
      entities[role].push(account);
      return account;
    }

    const subjects = new Map();
    const aliases = {
      python: ['Программирование на Python'],
      testing: ['Тестирование программного обеспечения'],
    };
    for (const [code, name] of Object.entries(plan.subjects)) {
      let row = mapped('subject', code);
      if (!row) {
        const names = [name, ...(aliases[code] || [])].map(normalized);
        row = available('subject').find((candidate) => names.includes(normalized(candidate.name)));
        if (!row) {
          row = { id: `academic-subject-${code}`, name };
          await tx
            .prepare('INSERT INTO school_subjects(id,name,name_key) VALUES (?,?,?)')
            .run(row.id, name, normalized(name));
          entities.subject.push(row);
        }
        await remember('subject', code, row);
      }
      subjects.set(code, row);
    }

    const oldAssignments = await tx.prepare('SELECT * FROM school_teaching_assignments').all();
    const oldSpecialties = await tx.prepare('SELECT * FROM school_teacher_subjects').all();
    // Reserve existing teachers for their closest block before filling the first block.
    // Otherwise a sole Python teacher would be consumed by the earlier mathematics block.
    const reservedTeachers = new Map();
    const reservedIds = new Set();
    const profileMatches = plan.teachers
      .flatMap((profile) => {
        if (mapped('teacher', profile.key)) return [];
        const ids = profile.subjectCodes.map((code) => subjects.get(code).id);
        return available('teacher').flatMap((candidate) => {
          const prior = oldSpecialties
            .filter((pair) => pair.teacher_id === candidate.id)
            .map((pair) => pair.subject_id);
          if (new Set([...prior, ...ids]).size > 3) return [];
          const score = oldAssignments.filter(
            (pair) => pair.teacher_id === candidate.id && ids.includes(pair.subject_id),
          ).length;
          return [{ profile, candidate, score }];
        });
      })
      .sort((left, right) => right.score - left.score);
    for (const match of profileMatches) {
      if (reservedTeachers.has(match.profile.key) || reservedIds.has(match.candidate.id)) continue;
      reservedTeachers.set(match.profile.key, match.candidate);
      reservedIds.add(match.candidate.id);
    }
    const teachers = [];
    for (const [index, profile] of plan.teachers.entries()) {
      let row = mapped('teacher', profile.key);
      const subjectIds = profile.subjectCodes.map((code) => subjects.get(code).id);
      if (!row) {
        row =
          reservedTeachers.get(profile.key) ||
          (await createAccount('teacher', profile.key, teacherNames[index]));
        await remember('teacher', profile.key, row);
      }
      for (const subjectId of subjectIds)
        await tx
          .prepare(
            'INSERT INTO school_teacher_subjects(teacher_id,subject_id) VALUES (?,?) ON CONFLICT DO NOTHING',
          )
          .run(row.id, subjectId);
      for (const language of profile.languages)
        await tx
          .prepare(
            'INSERT INTO school_teacher_languages(teacher_id,language) VALUES (?,?) ON CONFLICT DO NOTHING',
          )
          .run(row.id, language);
      teachers.push({ ...row, ...profile, subjectIds });
    }

    const groups = new Map();
    for (const [index, group] of plan.groups.entries()) {
      let row = mapped('group', group.key);
      if (!row) {
        const candidates = available('group');
        row =
          candidates.find(
            (candidate) =>
              candidate.program === group.program &&
              candidate.intake_year === group.intakeYear &&
              candidate.language === group.language,
          ) ||
          candidates.find((candidate) => normalized(candidate.name) === normalized(group.name)) ||
          candidates.find(
            (candidate) =>
              candidate.id.startsWith('demo-') &&
              !candidate.program &&
              candidate.course === group.course,
          ) ||
          candidates.find((candidate) => candidate.id.startsWith('demo-') && !candidate.program);
        if (!row) {
          row = {
            id: `academic-group-${group.key}`,
            name: group.name,
            course: group.course,
            curator_id: teachers[index].id,
          };
          await tx
            .prepare(
              'INSERT INTO school_groups(id,name,name_key,course,curator_id,program,intake_year,language) VALUES (?,?,?,?,?,?,?,?)',
            )
            .run(
              row.id,
              row.name,
              normalized(row.name),
              group.course,
              row.curator_id,
              group.program,
              group.intakeYear,
              group.language,
            );
          entities.group.push(row);
        } else {
          // Keep group IDs and student membership together; only synthetic display names may change.
          if (
            (row.program && row.program !== group.program) ||
            (row.intake_year && row.intake_year !== group.intakeYear) ||
            (row.language && row.language !== group.language)
          )
            throw new Error(
              `Группа ${row.id} уже имеет другой учебный профиль. Автоматическая замена отменена.`,
            );
          const name = row.id.startsWith('demo-') && row.version === 1 ? group.name : row.name;
          await tx
            .prepare(
              'UPDATE school_groups SET program=?,intake_year=?,language=?,course=?,name=?,name_key=? WHERE id=?',
            )
            .run(
              group.program,
              group.intakeYear,
              group.language,
              group.course,
              name,
              normalized(name),
              row.id,
            );
          Object.assign(row, { name, course: group.course });
        }
        await remember('group', group.key, row);
      }
      groups.set(group.key, { ...row, ...group, id: row.id });
    }

    const rooms = [];
    for (const room of plan.rooms) {
      let row = mapped('room', room.key);
      if (!row) {
        const candidates = available('room');
        row =
          candidates.find((candidate) => candidate.number === room.number) ||
          candidates.find((candidate) =>
            new RegExp(`^${room.number}(?:\\s|$)`).test(candidate.name),
          ) ||
          candidates.find((candidate) => candidate.id.startsWith('demo-') && !candidate.number);
        if (!row) {
          row = {
            id: `academic-${room.key}`,
            name: room.number,
            capacity: room.capacity,
            number: room.number,
            floor: room.floor,
            type: room.type,
          };
          await tx
            .prepare(
              'INSERT INTO school_rooms(id,name,name_key,capacity,number,floor,type) VALUES (?,?,?,?,?,?,?)',
            )
            .run(
              row.id,
              row.name,
              normalized(row.name),
              room.capacity,
              room.number,
              room.floor,
              room.type,
            );
          entities.room.push(row);
        } else {
          const synthetic = row.id.startsWith('demo-') && row.version === 1;
          if (row.number && row.number !== room.number)
            throw new Error(
              `Аудитория ${row.id} уже имеет другой номер. Автоматическая замена отменена.`,
            );
          const name = synthetic ? room.number : row.name;
          const capacity = synthetic ? Math.max(row.capacity || 0, room.capacity) : row.capacity;
          const floor = row.floor ?? room.floor;
          const type = row.type ?? room.type;
          if (floor !== room.floor || type !== room.type)
            warnings.push(
              `Аудитория ${row.id}: сохранены заданные вручную этаж ${floor} и тип ${type}.`,
            );
          await tx
            .prepare(
              'UPDATE school_rooms SET number=?,floor=?,type=?,name=?,name_key=?,capacity=? WHERE id=?',
            )
            .run(room.number, floor, type, name, normalized(name), capacity, row.id);
          Object.assign(row, { name, capacity, number: room.number, floor, type });
        }
        await remember('room', room.key, row);
      }
      rooms.push(row);
    }

    let studentIndex = 0;
    for (const group of groups.values()) {
      const current = entities.student.filter((student) => student.group_id === group.id);
      if (current.length > 20)
        warnings.push(
          `Группа ${group.id}: сохранены все ${current.length} студентов; ручные записи не удаляются.`,
        );
      for (let index = 0; index < 20; index++) {
        const key = `student-${group.key}-${index + 1}`;
        let row = mapped('student', key);
        if (!row) {
          // Do not redistribute students: existing group-based access must remain intact.
          row = current.find((candidate) => !used.has(`student:${candidate.id}`));
          if (!row && current.length < 20) {
            row = await createAccount(
              'student',
              key,
              academicStudentName(studentIndex, group.language),
              group.id,
            );
            current.push(row);
          }
          if (row) await remember('student', key, row);
        }
        studentIndex++;
      }
      group.roster = current.length;
    }

    for (const pair of plan.groupSubjects) {
      await tx
        .prepare(
          'INSERT INTO school_group_subjects(group_id,subject_id,academic_year,semester) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
        )
        .run(
          groups.get(pair.groupKey).id,
          subjects.get(pair.subjectCode).id,
          academicYear,
          pair.semester,
        );
    }

    const occupied = (
      await tx
        .prepare(
          "SELECT group_id,teacher_id,room_id,starts_at,ends_at FROM school_lessons WHERE status='scheduled' AND starts_at IS NOT NULL AND ends_at IS NOT NULL",
        )
        .all()
    ).map((lesson) => ({
      ...lesson,
      start: Date.parse(lesson.starts_at),
      end: Date.parse(lesson.ends_at),
    }));
    if (occupied.some((lesson) => !Number.isFinite(lesson.start) || !Number.isFinite(lesson.end)))
      throw new Error('Старое расписание содержит нечитаемую дату; заполнение отменено.');
    const daily = new Map();
    for (const lesson of occupied) {
      const key = `${lesson.group_id}:${new Date(lesson.start + OFFSET).toISOString().slice(0, 10)}`;
      daily.set(key, (daily.get(key) || 0) + 1);
    }
    const conflicts = (candidate) =>
      occupied.some(
        (other) =>
          other.start < candidate.end &&
          other.end > candidate.start &&
          (other.group_id === candidate.group_id ||
            other.teacher_id === candidate.teacher_id ||
            other.room_id === candidate.room_id),
      );
    const insertLesson = tx.prepare(
      'INSERT INTO school_lessons(id,group_id,subject_id,teacher_id,room_id,starts_at,ends_at,kind,status,note,practice_id,slot_id,academic_year,semester) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    const insertAssignment = tx.prepare(
      'INSERT INTO school_assignments(id,subject_id,group_id,teacher_id,title,type,description,steps_json,due_at,lesson_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    for (let week = 0; week < weeks.length; week++) {
      for (const [groupIndex, group] of [...groups.values()].entries()) {
        const curriculum = plan.groupSubjects.filter((pair) => pair.groupKey === group.key);
        for (const [subjectIndex, pair] of curriculum.entries()) {
          const subject = subjects.get(pair.subjectCode);
          const qualified = teachers.filter(
            (teacher) =>
              teacher.subjectIds.includes(subject.id) && teacher.languages.includes(group.language),
          );
          if (!qualified.length)
            throw new Error(`Нет преподавателя для ${group.name}/${subject.name}.`);
          for (const kind of ['lecture', 'practice']) {
            const allowedTypes = requiredRoomTypes(pair.subjectCode, kind);
            const suitable = rooms.filter(
              (room) => room.capacity >= group.roster && allowedTypes.includes(room.type),
            );
            let chosen;
            const preferredDay = (subjectIndex + (kind === 'practice' ? 2 : 0)) % 5;
            for (let dayTry = 0; dayTry < 5 && !chosen; dayTry++) {
              const date = weeks[week][(preferredDay + dayTry) % 5];
              if ((daily.get(`${group.id}:${date}`) || 0) >= 4) continue;
              for (let slotTry = 0; slotTry < ACADEMIC_SLOTS.length && !chosen; slotTry++) {
                const slot =
                  ACADEMIC_SLOTS[(slotTry + (groupIndex % 3) * 3) % ACADEMIC_SLOTS.length];
                for (let teacherTry = 0; teacherTry < qualified.length && !chosen; teacherTry++) {
                  const teacher = qualified[(teacherTry + week + subjectIndex) % qualified.length];
                  for (const room of suitable) {
                    const startsAt = new Date(`${date}T${slot.startsAt}:00+05:00`).toISOString();
                    const endsAt = new Date(`${date}T${slot.endsAt}:00+05:00`).toISOString();
                    const candidate = {
                      group_id: group.id,
                      teacher_id: teacher.id,
                      room_id: room.id,
                      start: Date.parse(startsAt),
                      end: Date.parse(endsAt),
                      startsAt,
                      endsAt,
                      date,
                      slot,
                    };
                    if (!conflicts(candidate)) {
                      chosen = candidate;
                      break;
                    }
                  }
                }
              }
            }
            if (!chosen)
              throw new Error(
                `Не найден свободный слот: неделя ${week + 1}, ${group.name}, ${subject.name}, ${kind}. Изменения отменены.`,
              );
            await tx
              .prepare(
                'INSERT INTO school_teaching_assignments(teacher_id,group_id,subject_id) VALUES (?,?,?) ON CONFLICT DO NOTHING',
              )
              .run(chosen.teacher_id, group.id, subject.id);
            const id = `academic-${academicYear}-w${week + 1}-${group.key}-${pair.subjectCode}-${kind}`;
            await insertLesson.run(
              id,
              group.id,
              subject.id,
              chosen.teacher_id,
              chosen.room_id,
              chosen.startsAt,
              chosen.endsAt,
              kind,
              'scheduled',
              `Учебный набор: ${subject.name}. Неделя ${week + 1}.`,
              null,
              chosen.slot.id,
              academicYear,
              1,
            );
            occupied.push(chosen);
            daily.set(
              `${group.id}:${chosen.date}`,
              (daily.get(`${group.id}:${chosen.date}`) || 0) + 1,
            );
            if (kind === 'practice') {
              const srspId = `${id}-srsp`;
              await insertLesson.run(
                srspId,
                group.id,
                subject.id,
                chosen.teacher_id,
                null,
                null,
                null,
                'srsp',
                'scheduled',
                'Самостоятельная работа под руководством преподавателя.',
                id,
                null,
                academicYear,
                1,
              );
              for (const [lessonId, type] of [
                [id, 'practice'],
                [srspId, 'srsp'],
              ]) {
                const title = `${subject.name}: ${type === 'srsp' ? 'СРСП' : 'практическая работа'} ${week + 1}`;
                const dueAt = new Date(Date.parse(chosen.endsAt) + 7 * DAY).toISOString();
                await insertAssignment.run(
                  `${lessonId}-assignment`,
                  subject.id,
                  group.id,
                  chosen.teacher_id,
                  title,
                  type,
                  `Отработайте материал темы «${subject.name}» и подготовьте краткий отчёт с выводами.`,
                  JSON.stringify([
                    'Изучите конспект занятия.',
                    'Выполните упражнения по теме.',
                    'Проверьте результат и загрузите отчёт.',
                  ]),
                  dueAt,
                  lessonId,
                );
              }
            }
          }
        }
      }
    }

    const legacyMismatch = await tx
      .prepare(
        `SELECT count(*) AS count FROM school_teaching_assignments a
      WHERE NOT EXISTS (SELECT 1 FROM school_teacher_subjects s WHERE s.teacher_id=a.teacher_id AND s.subject_id=a.subject_id)
      OR NOT EXISTS (SELECT 1 FROM school_group_subjects s WHERE s.group_id=a.group_id AND s.subject_id=a.subject_id AND s.academic_year=? AND s.semester=1)`,
      )
      .get(academicYear);
    if (Number(legacyMismatch.count))
      warnings.push(
        `Сохранены ${legacyMismatch.count} исторических назначений вне нового учебного плана. Backend должен различать исторические и новые занятия; автоматическое перераспределение запрещено.`,
      );
    const resultCounts = await counts(tx);
    await tx
      .prepare(
        'INSERT INTO school_demo_seeds(id,seed_date,counts_json,created_at) VALUES (?,?,?,?)',
      )
      .run(seedId, startDate, JSON.stringify(resultCounts), Date.now());
    if (onCredentials && accounts.length) await onCredentials(accounts);
    return { created: true, counts: resultCounts, accounts, warnings };
  });
}
