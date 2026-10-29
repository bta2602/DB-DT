/**
 * Fictional demonstration data, never real college records.
 * This factory has no storage, network, account or database side effects.
 */
export function createDemoData(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Некорректная дата демонстрации.');
  const offset = 5 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const seedDate = new Date(instant.getTime() + offset).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${seedDate}T00:00:00+05:00`);
  const at = (days, hour = 9, minute = 0) => new Date(dayStart + days * dayMs + (hour * 60 + minute) * 60000).toISOString();
  const relative = minutes => new Date(instant.getTime() + minutes * 60000).toISOString();
  const profiles = { adminId: 'demo-admin', teacherId: 'demo-teacher-1', studentId: 'demo-student-1' };
  const users = [
    { id: profiles.adminId, name: 'Администратор демо', email: 'admin@example.test', role: 'admin', groupId: null, version: 1 },
    { id: profiles.teacherId, name: 'Алия Нурланова', email: 'teacher@example.test', role: 'teacher', groupId: null, version: 1 },
    { id: 'demo-teacher-2', name: 'Марат Садыков', email: 'math-teacher@example.test', role: 'teacher', groupId: null, version: 1 },
    { id: 'demo-teacher-3', name: 'Динара Асанова', email: 'design-teacher@example.test', role: 'teacher', groupId: null, version: 1 },
  ];
  const studentNames = [
    'Айдана Серикова', 'Тимур Омаров', 'Аружан Нуриева', 'Данияр Беков', 'Алина Касымова', 'Ерасыл Муратов',
    'Амина Толеуова', 'Арман Исаев', 'София Каримова', 'Руслан Абдиев', 'Мадина Есенова', 'Нурислам Алимов',
  ];
  studentNames.forEach((name, index) => users.push({
    id: `demo-student-${index + 1}`, name, email: `student${index + 1}@example.test`,
    role: 'student', groupId: index < 6 ? 'demo-group-1' : 'demo-group-2', version: 1,
  }));
  const groups = [
    { id: 'demo-group-1', name: 'ИС-21 · демо', course: 2, curatorId: profiles.teacherId, version: 1 },
    { id: 'demo-group-2', name: 'ИС-22 · демо', course: 2, curatorId: 'demo-teacher-2', version: 1 },
  ];
  const subjects = [
    { id: 'demo-subject-db', name: 'Базы данных · демо', version: 1 },
    { id: 'demo-subject-web', name: 'Веб-разработка · демо', version: 1 },
    { id: 'demo-subject-math', name: 'Прикладная математика · демо', version: 1 },
    { id: 'demo-subject-design', name: 'Проектирование интерфейсов · демо', version: 1 },
  ];
  const rooms = [
    { id: 'demo-room-1', name: '201 · компьютерный класс · демо', capacity: 24, version: 1 },
    { id: 'demo-room-2', name: '205 · лекционная · демо', capacity: 30, version: 1 },
    { id: 'demo-room-3', name: '302 · проектная · демо', capacity: 20, version: 1 },
    { id: 'demo-room-4', name: '304 · лаборатория · демо', capacity: 16, version: 1 },
  ];
  const teachingAssignments = [
    { teacherId: profiles.teacherId, groupId: 'demo-group-1', subjectId: 'demo-subject-db' },
    { teacherId: profiles.teacherId, groupId: 'demo-group-1', subjectId: 'demo-subject-web' },
    { teacherId: 'demo-teacher-3', groupId: 'demo-group-1', subjectId: 'demo-subject-design' },
    { teacherId: 'demo-teacher-2', groupId: 'demo-group-2', subjectId: 'demo-subject-math' },
    { teacherId: 'demo-teacher-3', groupId: 'demo-group-2', subjectId: 'demo-subject-design' },
  ];
  const lessons = [];
  const addLesson = (id, groupId, subjectId, teacherId, roomId, startsAt, kind = 'Практика', note = '') => {
    lessons.push({
      id: `demo-lesson-${id}`, groupId, subjectId, teacherId, roomId, startsAt,
      endsAt: new Date(Date.parse(startsAt) + 80 * 60000).toISOString(), kind,
      status: 'scheduled', note, version: 1, attendanceVersion: 1,
    });
  };
  for (const day of [-2, -1]) {
    addLesson(`past-${-day}-db`, 'demo-group-1', 'demo-subject-db', profiles.teacherId, 'demo-room-1', at(day, 9), 'Практика', 'Связи таблиц и первичные ключи.');
    addLesson(`past-${-day}-web`, 'demo-group-1', 'demo-subject-web', profiles.teacherId, 'demo-room-1', at(day, 10, 40), 'Лабораторная', 'Семантическая разметка и адаптивная вёрстка.');
    addLesson(`past-${-day}-math`, 'demo-group-2', 'demo-subject-math', 'demo-teacher-2', 'demo-room-2', at(day, 9), 'Практика');
    addLesson(`past-${-day}-design`, 'demo-group-2', 'demo-subject-design', 'demo-teacher-3', 'demo-room-3', at(day, 10, 40), 'Проектная работа');
  }
  // At least one class is in progress at the moment the demonstration is created,
  // even when the reviewer opens it outside ordinary college hours.
  const activeStart = Math.max(dayStart, Math.floor(instant.getTime() / 60000) * 60000 - 20 * 60000);
  const activeTime = new Date(activeStart).toISOString();
  const nextTime = new Date(activeStart + 100 * 60000).toISOString();
  addLesson('current-db', 'demo-group-1', 'demo-subject-db', profiles.teacherId, 'demo-room-1', activeTime, 'Практика', 'Демонстрационное занятие: SQL-запросы с JOIN.');
  addLesson('current-math', 'demo-group-2', 'demo-subject-math', 'demo-teacher-2', 'demo-room-2', activeTime, 'Лекция', 'Демонстрационное занятие: обработка учебной выборки.');
  addLesson('next-web', 'demo-group-1', 'demo-subject-web', profiles.teacherId, 'demo-room-1', nextTime, 'Лабораторная', 'Форма обратной связи: состояния и валидация.');
  addLesson('next-design', 'demo-group-2', 'demo-subject-design', 'demo-teacher-3', 'demo-room-3', nextTime, 'Практика');
  for (const day of [1, 2]) {
    addLesson(`future-${day}-db`, 'demo-group-1', 'demo-subject-db', profiles.teacherId, 'demo-room-1', at(day, 9), 'Лекция');
    addLesson(`future-${day}-design`, 'demo-group-1', 'demo-subject-design', 'demo-teacher-3', 'demo-room-3', at(day, 10, 40), 'Проектная работа');
    addLesson(`future-${day}-math`, 'demo-group-2', 'demo-subject-math', 'demo-teacher-2', 'demo-room-2', at(day, 9), 'Практика');
  }
  lessons.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const assignments = [
    {
      id: 'demo-assignment-schema', subjectId: 'demo-subject-db', groupId: 'demo-group-1', teacherId: profiles.teacherId,
      title: 'Схема базы данных учебного центра', type: 'Практическая работа',
      description: 'Спроектируйте таблицы студентов, групп и занятий. Объясните выбор первичных и внешних ключей. Все данные в примере вымышлены.',
      steps: ['Опишите три сущности и их поля.', 'Добавьте связи между таблицами.', 'Подготовьте SQL-файл с CREATE TABLE и коротким пояснением.'],
      dueAt: at(-1, 18), version: 1,
    },
    {
      id: 'demo-assignment-web', subjectId: 'demo-subject-web', groupId: 'demo-group-1', teacherId: profiles.teacherId,
      title: 'Адаптивная страница расписания', type: 'Лабораторная работа',
      description: 'Подготовьте структуру страницы расписания для компьютера и смартфона. Опишите навигацию, состояния пустого списка и сообщения об ошибках.',
      steps: ['Выделите основные блоки страницы.', 'Опишите поведение при ширине 390 и 1280 px.', 'Проверьте названия полей и доступность кнопок.'],
      dueAt: at(1, 18), version: 1,
    },
    {
      id: 'demo-assignment-joins', subjectId: 'demo-subject-db', groupId: 'demo-group-1', teacherId: profiles.teacherId,
      title: 'SQL: выборки и объединение таблиц', type: 'Самостоятельная работа',
      description: 'Напишите запросы для списка студентов с названиями групп, количества студентов по группам и ближайших занятий. Используйте демонстрационную схему.',
      steps: ['Составьте запрос с INNER JOIN.', 'Посчитайте количество студентов через GROUP BY.', 'Добавьте сортировку занятий по времени.'],
      dueAt: at(3, 18), version: 1,
    },
    {
      id: 'demo-assignment-prototype', subjectId: 'demo-subject-design', groupId: 'demo-group-1', teacherId: 'demo-teacher-3',
      title: 'Прототип личного кабинета', type: 'Мини-проект',
      description: 'Опишите сценарий студента: открыть расписание, найти задание и отправить работу. Подготовьте текстовое пояснение к трём экранам.',
      steps: ['Запишите цель каждого экрана.', 'Укажите основные действия пользователя.', 'Добавьте пустое состояние и состояние успешной отправки.'],
      dueAt: at(5, 18), version: 1,
    },
    {
      id: 'demo-assignment-statistics', subjectId: 'demo-subject-math', groupId: 'demo-group-2', teacherId: 'demo-teacher-2',
      title: 'Среднее значение и медиана', type: 'Практическая работа',
      description: 'Для учебного набора 8, 12, 12, 14, 19 вычислите среднее и медиану. Поясните, как меняются результаты при добавлении значения 100.',
      steps: ['Запишите исходные вычисления.', 'Добавьте 100 и пересчитайте показатели.', 'Объясните влияние выброса.'],
      dueAt: at(2, 18), version: 1,
    },
    {
      id: 'demo-assignment-navigation', subjectId: 'demo-subject-design', groupId: 'demo-group-2', teacherId: 'demo-teacher-3',
      title: 'Навигация учебного портала', type: 'Практическая работа',
      description: 'Предложите пункты меню для студента и преподавателя. Укажите, какие действия требуют подтверждения и почему.',
      steps: ['Составьте два варианта меню.', 'Проверьте понятность названий.', 'Опишите возвращение к предыдущему экрану.'],
      dueAt: at(-1, 18), version: 1,
    },
  ];
  const files = {};
  const addFile = (id, name, text) => {
    const mimeType = 'text/plain;charset=utf-8';
    files[id] = { name, mimeType, text };
    return { id, name, mimeType, bytes: new TextEncoder().encode(text).length };
  };
  const schemaText = `-- Вымышленная работа для демонстрации StudyHUB\nCREATE TABLE study_groups (\n  id INTEGER PRIMARY KEY,\n  name VARCHAR(60) NOT NULL UNIQUE\n);\n\nCREATE TABLE students (\n  id INTEGER PRIMARY KEY,\n  full_name VARCHAR(120) NOT NULL,\n  group_id INTEGER NOT NULL REFERENCES study_groups(id)\n);\n\nCREATE TABLE lessons (\n  id INTEGER PRIMARY KEY,\n  group_id INTEGER NOT NULL REFERENCES study_groups(id),\n  subject VARCHAR(120) NOT NULL,\n  starts_at TIMESTAMP NOT NULL\n);\n\n-- Внешние ключи не позволяют привязать студента или занятие\n-- к несуществующей группе.\n`;
  const webText = `ДЕМОНСТРАЦИОННАЯ РАБОТА — вымышленные данные\n\nАдаптивная страница расписания\n\n1. На компьютере: боковое меню, выбор даты, фильтр группы, карточки занятий.\n2. На смартфоне: меню открывается отдельной панелью, карточки идут в одну колонку.\n3. У каждого занятия видны предмет, время, преподаватель и аудитория.\n4. Если занятий нет, показываем выбранную дату и предложение выбрать другой день.\n5. При ошибке загрузки сохраняем фильтры и показываем кнопку «Повторить».\n6. Все поля имеют подписи; на кнопки можно перейти клавишей Tab.\n`;
  const joinsText = `-- Демонстрационная работа: данные вымышлены\nSELECT s.full_name, g.name AS group_name\nFROM students AS s\nINNER JOIN study_groups AS g ON g.id = s.group_id\nORDER BY g.name, s.full_name;\n\nSELECT g.name, COUNT(s.id) AS student_count\nFROM study_groups AS g\nLEFT JOIN students AS s ON s.group_id = g.id\nGROUP BY g.id, g.name;\n`;
  const submissions = [];
  const addSubmission = (assignmentId, studentNumber, status, text, extension = 'txt', grade = null, comment = '', minutesAgo = 90) => {
    const id = `demo-submission-${assignmentId.replace('demo-assignment-', '')}-${studentNumber}`;
    submissions.push({
      id, assignmentId, studentId: `demo-student-${studentNumber}`, status,
      submittedAt: relative(-minutesAgo),
      file: addFile(`${id}-file`, `demo-work-${studentNumber}.${extension}`, text),
      grade, comment, version: 1,
    });
  };
  addSubmission('demo-assignment-schema', 1, 'reviewed', schemaText, 'sql', 4, 'Связи описаны верно. Добавьте ограничение на время окончания занятия.', 26 * 60);
  addSubmission('demo-assignment-schema', 2, 'submitted', schemaText, 'sql', null, '', 140);
  addSubmission('demo-assignment-schema', 3, 'revision', '-- Демонстрационная работа\nCREATE TABLE students (id INTEGER, name TEXT, group_name TEXT);\n', 'sql', null, 'Выделите группы в отдельную таблицу и добавьте первичный и внешний ключи.', 25 * 60);
  addSubmission('demo-assignment-schema', 4, 'reviewed', schemaText, 'sql', 5, 'Структура понятная, связи и ограничения описаны.', 27 * 60);
  addSubmission('demo-assignment-schema', 5, 'submitted', schemaText, 'sql', null, '', 70);
  addSubmission('demo-assignment-web', 1, 'submitted', webText, 'txt', null, '', 45);
  addSubmission('demo-assignment-web', 2, 'reviewed', webText, 'txt', 5, 'Учтены мобильный экран, пустое состояние и доступность.', 23 * 60);
  addSubmission('demo-assignment-web', 3, 'revision', webText, 'txt', null, 'Дополните описание примерами сообщений об ошибках.', 22 * 60);
  addSubmission('demo-assignment-joins', 2, 'submitted', joinsText, 'sql', null, '', 20);
  addSubmission('demo-assignment-statistics', 7, 'submitted', 'Демонстрационная работа\nСреднее: (8 + 12 + 12 + 14 + 19) / 5 = 13.\nМедиана: 12.\nПосле добавления 100 среднее равно 27,5; медиана — 13.\nВыброс значительно влияет на среднее.\n', 'txt', null, '', 80);
  addSubmission('demo-assignment-navigation', 8, 'reviewed', 'Демонстрационная работа\nСтудент: Сегодня, Расписание, Предметы, Задания.\nПреподаватель: Сегодня, Журнал, Проверка работ, Мои задания.\nПосле сохранения показываем подтверждение и возвращаем фокус к действию.\n', 'txt', 4, 'Меню разделены по задачам. Добавьте сценарий выхода из аккаунта.', 28 * 60);
  const grades = [];
  const attendance = [];
  lessons.filter(lesson => lesson.id.includes('-past-')).forEach((lesson, lessonIndex) => {
    users.filter(user => user.role === 'student' && user.groupId === lesson.groupId).forEach((student, studentIndex) => {
      if ((lessonIndex + studentIndex) % 5 !== 0) grades.push({
        lessonId: lesson.id, studentId: student.id, grade: [5, 4, 5, 3, 4, 2][(lessonIndex + studentIndex) % 6], version: 1,
      });
      attendance.push({
        lessonId: lesson.id, studentId: student.id,
        status: ['present', 'present', 'late', 'present', 'absent', 'excused'][(lessonIndex + studentIndex) % 6],
      });
    });
  });
  // Leave most current-class marks empty so a reviewer can try attendance entry.
  attendance.push(
    { lessonId: 'demo-lesson-current-db', studentId: profiles.studentId, status: 'present' },
    { lessonId: 'demo-lesson-current-db', studentId: 'demo-student-2', status: 'late' },
  );
  addFile('demo-material-sql-file', 'demo-sql-guide.txt', 'Демонстрационный материал\n\nПамятка по SQL\nSELECT — выбрать столбцы.\nWHERE — отфильтровать строки.\nJOIN — связать таблицы.\nGROUP BY — сгруппировать результат.\nORDER BY — отсортировать строки.\n\nПроверьте, что внешний ключ ссылается на существующий первичный ключ.\n');
  addFile('demo-material-web-file', 'demo-web-checklist.txt', 'Демонстрационный материал\n\nПроверка интерфейса\n[ ] У полей есть подписи.\n[ ] Состояния загрузки и ошибки понятны.\n[ ] Кнопки доступны с клавиатуры.\n[ ] На узком экране нет обрезанного текста.\n[ ] После сохранения показано подтверждение.\n');
  const materials = [
    { id: 'demo-material-sql', subjectId: 'demo-subject-db', title: 'Памятка по SQL · демо', fileId: 'demo-material-sql-file' },
    { id: 'demo-material-web', subjectId: 'demo-subject-web', title: 'Чек-лист интерфейса · демо', fileId: 'demo-material-web-file' },
  ];
  const announcements = [
    { id: 'demo-notice-fiction', title: 'Демонстрационные данные', body: 'Записи с пометкой «демо», связанные с ними пользователи и работы — вымышленные примеры для проверки проекта.', publishedAt: relative(-5) },
    { id: 'demo-notice-review', title: 'Попробуйте проверку работы', body: 'В кабинете преподавателя откройте «Проверка работ»: доступны SQL-файлы и текстовые ответы с разными статусами.', publishedAt: at(-1, 12) },
    { id: 'demo-notice-student', title: 'Проверьте взгляд студента', body: 'В журнале уже есть примеры оценок и посещаемости. В кабинете студента видны его собственные результаты и задания.', publishedAt: at(-2, 12) },
  ];
  return {
    seedDate, profiles, files,
    data: { users, groups, subjects, rooms, teachingAssignments, lessons, assignments, submissions, grades, attendance, materials, announcements },
  };
}
