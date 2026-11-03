export const CAMPUS_SEED_ID = 'studyhub-campus-v3';
export const LESSON_SLOTS = [510, 610, 710, 840, 940, 1040];
const MINUTE = 60000;
const DAY = 86400000;
const OFFSET = 5 * 60 * MINUTE;

// Пакет добавляет учебные записи. Уже существующие ID и пользовательские правки не заменяются.
export function createCampusData(now = new Date(), existing) {
  if (!existing || !Array.isArray(existing.users))
    throw new Error('Сначала подготовьте базовые справочники.');
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('Некорректная дата заполнения.');
  const seedDate = new Date(instant.getTime() + OFFSET).toISOString().slice(0, 10);
  const today = Date.parse(`${seedDate}T00:00:00+05:00`);
  const weekDay = new Date(today + OFFSET).getUTCDay();
  const monday = today - ((weekDay + 6) % 7) * DAY;
  const data = Object.fromEntries(
    [
      'users',
      'groups',
      'subjects',
      'rooms',
      'teachingAssignments',
      'lessons',
      'assignments',
      'submissions',
      'grades',
      'attendance',
      'materials',
      'announcements',
    ].map((key) => [key, []]),
  );
  const files = {};
  const profiles = {
    adminId: 'demo-admin',
    teacherId: 'demo-teacher-1',
    studentId: 'demo-student-1',
  };
  const teacherNames = [
    'Айгерим Тлеубекова',
    'Дамир Кожахметов',
    'Гульмира Ибраева',
    'Руслан Абдрахманов',
    'Елена Миронова',
    'Санжар Сулейменов',
    'Мадина Бекенова',
    'Арман Турсунов',
    'Ольга Федорова',
    'Тимур Жаксылыков',
    'Дана Куанышова',
    'Алексей Соколов',
    'Жанар Нурбекова',
  ];
  teacherNames.forEach((name, index) =>
    data.users.push({
      id: `demo-campus-teacher-${index + 1}`,
      name,
      email: `lecturer${index + 4}@studyhub.example`,
      role: 'teacher',
      groupId: null,
      version: 1,
    }),
  );
  const teachers = [
    ...existing.users.filter((user) => user.role === 'teacher' && user.id.startsWith('demo-')),
    ...data.users,
  ];
  const groupNames = [
    'ИС-11',
    'ИС-12',
    'ИС-23',
    'ИС-24',
    'ИС-31',
    'ИС-32',
    'ПИ-11',
    'ПИ-12',
    'ПИ-21',
    'ПИ-22',
    'ПИ-31',
    'ПИ-32',
    'КС-21',
    'КС-22',
  ];
  const oldNames = new Set(existing.groups.map((group) => group.name));
  groupNames.forEach((base, index) => {
    let name = base;
    while (oldNames.has(name)) name += 'А';
    oldNames.add(name);
    data.groups.push({
      id: `demo-campus-group-${index + 1}`,
      name,
      course: Number(base.split('-')[1][0]),
      curatorId: teachers[index % teachers.length].id,
      version: 1,
    });
  });
  const groups = [
    ...existing.groups.filter((group) => group.id.startsWith('demo-')),
    ...data.groups,
  ];
  const firstNames = [
    'Дарина',
    'Адиль',
    'Аяжан',
    'Дамир',
    'Меруерт',
    'Бекзат',
    'Диана',
    'Нурбек',
    'Камиля',
    'Алишер',
    'Раяна',
    'Ильяс',
    'Томирис',
    'Азамат',
    'Аделя',
    'Султан',
    'Вероника',
    'Никита',
    'Анастасия',
    'Максим',
    'Милана',
    'Роман',
    'Алиса',
    'Дмитрий',
    'Назерке',
    'Самат',
    'Зарина',
    'Ерсултан',
    'Сабина',
    'Расул',
    'Инкар',
    'Бауыржан',
  ];
  const families = [
    ['Ахметов', 'Ахметова'],
    ['Сагатов', 'Сагатова'],
    ['Талгатов', 'Талгатова'],
    ['Кайратов', 'Кайратова'],
    ['Бекжанов', 'Бекжанова'],
    ['Оразов', 'Оразова'],
    ['Аманов', 'Аманова'],
    ['Нуралиев', 'Нуралиева'],
    ['Калдыбаев', 'Калдыбаева'],
    ['Толеубаев', 'Толеубаева'],
    ['Максутов', 'Максутова'],
    ['Абилов', 'Абилова'],
    ['Муханов', 'Муханова'],
    ['Досов', 'Досова'],
    ['Аскаров', 'Аскарова'],
    ['Ержанов', 'Ержанова'],
  ];
  let studentNumber = 0;
  for (const group of groups) {
    const count = existing.users.filter(
      (user) => user.role === 'student' && user.groupId === group.id,
    ).length;
    for (let index = count; index < 20; index++) {
      const number = studentNumber++;
      const family = families[Math.floor(number / firstNames.length) % families.length];
      const name = `${firstNames[number % firstNames.length]} ${family[number % 2 === 0 ? 1 : 0]}`;
      data.users.push({
        id: `demo-campus-student-${number + 1}`,
        name,
        email: `s${String(number + 101).padStart(4, '0')}@students.studyhub.example`,
        role: 'student',
        groupId: group.id,
        version: 1,
      });
    }
  }
  const subjectNames = [
    'Алгоритмы и структуры данных',
    'Компьютерные сети',
    'Программирование на Python',
    'Тестирование программного обеспечения',
    'Операционные системы',
    'Информационная безопасность',
    'Английский язык в IT',
    'Управление IT-проектами',
  ];
  subjectNames.forEach((base, index) =>
    data.subjects.push({
      id: `demo-campus-subject-${index + 1}`,
      name: existing.subjects.some((subject) => subject.name === base)
        ? `${base}: практикум`
        : base,
      version: 1,
    }),
  );
  const subjects = [...existing.subjects, ...data.subjects];
  for (let index = 0; index < 12; index++)
    data.rooms.push({
      id: `demo-campus-room-${index + 1}`,
      name: `${501 + index} · ${index % 3 === 0 ? 'лекционная аудитория' : 'компьютерный класс'}`,
      capacity: index % 3 === 0 ? 30 : 24,
      version: 1,
    });
  const rooms = [...existing.rooms, ...data.rooms].filter((room) => room.capacity >= 20);
  const students = [...existing.users, ...data.users].filter((user) => user.role === 'student');
  const occupied = [...existing.lessons.filter((lesson) => lesson.status !== 'cancelled')];
  const pairKeys = new Set(
    (existing.teachingAssignments || []).map(
      (pair) => `${pair.teacherId}|${pair.groupId}|${pair.subjectId}`,
    ),
  );
  const teacherSubject = (teacher) =>
    teacher.id === 'demo-teacher-1'
      ? subjects.find((subject) => subject.id === 'demo-subject-db')
      : teacher.id === 'demo-teacher-2'
        ? subjects.find((subject) => subject.id === 'demo-subject-math')
        : teacher.id === 'demo-teacher-3'
          ? subjects.find((subject) => subject.id === 'demo-subject-design')
          : subjects[(teachers.indexOf(teacher) - 2 + subjects.length) % subjects.length];
  function conflict(candidate) {
    return occupied.some(
      (lesson) =>
        lesson.startsAt < candidate.endsAt &&
        lesson.endsAt > candidate.startsAt &&
        (lesson.groupId === candidate.groupId ||
          lesson.teacherId === candidate.teacherId ||
          lesson.roomId === candidate.roomId),
    );
  }
  for (let week = -1; week <= 2; week++) {
    for (let day = 0; day < 5; day++) {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];
        const shift = groupIndex % 16 < 8 ? 0 : 3;
        for (let period = 0; period < 3; period++) {
          const teacher = teachers[(groupIndex + day * 3 + period) % teachers.length];
          const subject = teacherSubject(teacher);
          const start = monday + (week * 7 + day) * DAY + LESSON_SLOTS[shift + period] * MINUTE;
          const groupSize = students.filter((student) => student.groupId === group.id).length;
          const adequateRooms = rooms.filter((room) => room.capacity >= groupSize);
          if (!adequateRooms.length)
            throw new Error(`Нет аудитории для группы ${group.name} (${groupSize} студентов).`);
          const room = adequateRooms[groupIndex % adequateRooms.length];
          const lesson = {
            id: `demo-campus-lesson-${week + 2}-${day + 1}-${groupIndex + 1}-${period + 1}`,
            groupId: group.id,
            teacherId: teacher.id,
            subjectId: subject.id,
            roomId: room.id,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(start + 80 * MINUTE).toISOString(),
            kind: period === 0 ? 'Лекция' : 'Практика',
            status: 'scheduled',
            note: `${subject.name}: тема ${day * 3 + period + 1}`,
            version: 1,
            attendanceVersion: 1,
          };
          if (conflict(lesson)) continue;
          occupied.push(lesson);
          data.lessons.push(lesson);
          const pair = { teacherId: teacher.id, groupId: group.id, subjectId: subject.id };
          const key = `${teacher.id}|${group.id}|${subject.id}`;
          if (!pairKeys.has(key)) {
            pairKeys.add(key);
            data.teachingAssignments.push(pair);
          }
        }
      }
    }
  }
  for (const [lessonIndex, lesson] of data.lessons.entries()) {
    if (Date.parse(lesson.endsAt) >= instant.getTime()) continue;
    const roster = students.filter((student) => student.groupId === lesson.groupId);
    roster.forEach((student, index) => {
      const value = (lessonIndex * 7 + index * 3) % 20;
      const status =
        value === 0 ? 'absent' : value === 1 ? 'excused' : value === 2 ? 'late' : 'present';
      data.attendance.push({ lessonId: lesson.id, studentId: student.id, status });
      if (['present', 'late'].includes(status) && (lessonIndex + index) % 3 === 0)
        data.grades.push({
          lessonId: lesson.id,
          studentId: student.id,
          grade: [4, 5, 4, 3, 5, 4, 3, 5, 4, 2][(lessonIndex + index) % 10],
          version: 1,
        });
    });
  }
  const putFile = (id, name, text) => {
    files[id] = { name, mimeType: 'text/plain', text };
    return { id, name, mimeType: 'text/plain', bytes: new TextEncoder().encode(text).length };
  };
  groups.forEach((group, groupIndex) => {
    const pairs = data.teachingAssignments.filter((pair) => pair.groupId === group.id).slice(0, 3);
    pairs.forEach((pair, index) => {
      const subject = subjects.find((item) => item.id === pair.subjectId);
      const task = {
        id: `demo-campus-assignment-${groupIndex + 1}-${index + 1}`,
        ...pair,
        title: `${subject.name}: практическая работа ${index + 1}`,
        type: index === 2 ? 'Самостоятельная работа' : 'Практическая работа',
        description: `Изучите материал по дисциплине «${subject.name}». Решите задачу по теме недели и объясните принятые решения. В начале файла укажите фамилию и группу.`,
        steps: [
          'Сформулируйте цель и исходные данные.',
          'Подготовьте решение и проверьте результат.',
          'Оформите пояснение и отправьте один файл.',
        ],
        dueAt: new Date(today + [-1, 2, 7][index] * DAY + 18 * 60 * MINUTE).toISOString(),
        version: 1,
      };
      data.assignments.push(task);
      students
        .filter((student) => student.groupId === group.id)
        .slice(0, index === 2 ? 5 : 14)
        .forEach((student, studentIndex) => {
          const id = `demo-campus-submission-${groupIndex + 1}-${index + 1}-${studentIndex + 1}`;
          const status =
            studentIndex % 7 === 0 ? 'revision' : studentIndex % 4 === 0 ? 'submitted' : 'reviewed';
          const text = `${student.name}\nГруппа: ${group.name}\n${task.title}\n\nЦель: закрепить тему занятия и проверить решение на нескольких примерах.\n\n1. Выписаны исходные данные и ограничения.\n2. Подготовлено решение по алгоритму из конспекта.\n3. Проверены обычный случай и граничные значения.\n\nВывод: результат соответствует условиям; пояснение содержит порядок действий и найденные ограничения.\n`;
          data.submissions.push({
            id,
            assignmentId: task.id,
            studentId: student.id,
            status,
            submittedAt: new Date(
              instant.getTime() - (studentIndex + index + 1) * 90 * MINUTE,
            ).toISOString(),
            file: putFile(
              `${id}-file`,
              `work-${groupIndex + 1}-${index + 1}-${studentIndex + 1}.txt`,
              text,
            ),
            grade: status === 'reviewed' ? [4, 5, 4, 3, 5][studentIndex % 5] : null,
            comment:
              status === 'reviewed'
                ? 'Основная часть выполнена верно. Обратите внимание на оформление выводов.'
                : status === 'revision'
                  ? 'Добавьте проверку граничного случая и поясните порядок действий.'
                  : '',
            version: 1,
          });
        });
    });
  });
  data.subjects.forEach((subject, index) => {
    const id = `demo-campus-material-${index + 1}`;
    const file = putFile(
      `${id}-file`,
      `lecture-notes-${index + 1}.txt`,
      `${subject.name}\n\nПлан самостоятельной подготовки\n1. Повторите определения из конспекта лекции.\n2. Разберите пример, выполненный на практическом занятии.\n3. Решите аналогичную задачу самостоятельно.\n4. Запишите вопросы для консультации.\n\nКритерии: корректность решения, обоснование, проверка результата и оформление.\n`,
    );
    data.materials.push({
      id,
      subjectId: subject.id,
      title: `${subject.name}: план подготовки`,
      fileId: file.id,
    });
  });
  data.announcements.push({
    id: 'demo-campus-notice-consultation',
    title: 'Консультации перед защитой проектов',
    body: 'На этой неделе консультации проходят после занятий. Согласуйте время с преподавателем и подготовьте работающую версию проекта.',
    publishedAt: new Date(today + 8 * 60 * MINUTE).toISOString(),
  });
  return { seedId: CAMPUS_SEED_ID, seedDate, profiles, files, data };
}
