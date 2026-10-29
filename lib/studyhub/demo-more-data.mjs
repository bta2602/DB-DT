/** Additional fictional records. This factory never writes to storage or changes its input. */
export function createMoreDemoData(now = new Date(), existing) {
  const instant = new Date(now), dayMs = 86400000, minuteMs = 60000;
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Некорректная дата демонстрации.');
  if (!existing || !['users', 'groups', 'subjects', 'rooms', 'lessons'].every(key => Array.isArray(existing[key]))) {
    throw new TypeError('Для расширения нужны существующие справочники и расписание.');
  }
  const profiles = { teacherId: 'demo-teacher-1', studentId: 'demo-student-1' };
  for (const [collection, id] of [
    ['users', profiles.teacherId], ['users', 'demo-teacher-2'], ['users', profiles.studentId],
    ['groups', 'demo-group-1'], ['groups', 'demo-group-2'], ['subjects', 'demo-subject-db'],
  ]) {
    if (!existing[collection].some(record => record.id === id)) throw new Error('Сначала загрузите основной набор: npm run demo:seed.');
  }
  const seedDate = new Date(instant.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${seedDate}T00:00:00+05:00`);
  const at = (days, hour = 9, minute = 0) => dayStart + days * dayMs + (hour * 60 + minute) * minuteMs;
  const iso = value => new Date(value).toISOString();
  const isWeekday = value => ![0, 6].includes(new Date(value + 5 * 3600000).getUTCDay());
  const teachers = [
    ['algorithms', 'Жанна Ахметова', 'algorithms-more@example.test'],
    ['networks', 'Санжар Елемесов', 'networks-more@example.test'],
    ['python', 'Елена Соколова', 'python-more@example.test'],
    ['quality', 'Рауан Ниязов', 'quality-more@example.test'],
  ].map(([key, name, email]) => ({ id: `demo-more-teacher-${key}`, name, email, role: 'teacher', groupId: null, version: 1 }));
  const groups = [
    { id: 'demo-more-group-1', name: 'ПИ-31 · демо', course: 3, curatorId: profiles.teacherId, version: 1 },
    { id: 'demo-more-group-2', name: 'ИС-11 · демо', course: 1, curatorId: teachers[0].id, version: 1 },
    { id: 'demo-more-group-3', name: 'ИС-12 · демо', course: 1, curatorId: teachers[2].id, version: 1 },
    { id: 'demo-more-group-4', name: 'ПИ-32 · демо', course: 3, curatorId: teachers[1].id, version: 1 },
  ];
  const studentNames = [
    'Аяулым Кенжеева', 'Дамир Ермеков', 'Мария Белова', 'Бекзат Нуртаев', 'Карина Волкова', 'Алихан Сеитов',
    'Назерке Алимжанова', 'Илья Зайцев', 'Асылбек Турсунов', 'Виктория Лукина', 'Самат Жумаев', 'Диана Романова',
    'Асел Даулетова', 'Никита Павлов', 'Жансая Байжанова', 'Мирас Касенов', 'Полина Фролова', 'Адиль Оспанов',
    'Аделя Нургалиева', 'Дмитрий Орлов', 'Камила Абилова', 'Нурбек Талгатов', 'Вероника Мельникова', 'Олжас Жаксылыков',
    'Дарья Крылова', 'Еркебулан Сагатов', 'Айым Куанышова', 'Денис Миронов', 'Зарина Бекенова', 'Батырхан Сулейменов',
    'Анастасия Лебедева', 'Искандер Есенов', 'Меруерт Кайратова', 'Роман Громов', 'Дильназ Ержанова', 'Тамерлан Абдрахманов',
    'Екатерина Зорина', 'Султан Рахимов', 'Инкар Толеубаева', 'Максим Лосев', 'Даяна Бекжанова', 'Бауыржан Аскаров',
    'Ангелина Фомина', 'Шынгыс Бекмурзин', 'Ажар Сарсенова', 'Владислав Титов', 'Айсулу Калдыбаева', 'Ислам Нуралиев',
    'Сабина Максутова', 'Артём Рябов', 'Гульназ Нурбекова', 'Ерсултан Алиев', 'Ксения Егорова', 'Расул Муханов',
    'Надежда Ильина', 'Алишер Оразов', 'Томирис Аманова', 'Глеб Сафонов', 'Раяна Серикбаева', 'Азамат Досов',
  ];
  const students = studentNames.map((name, index) => ({
    id: `demo-more-student-${index + 1}`, name, email: `student-more-${index + 1}@example.test`, role: 'student',
    groupId: index < 6 ? 'demo-group-1' : index < 12 ? 'demo-group-2' : groups[Math.floor((index - 12) / 12)].id,
    version: 1,
  }));
  const users = [...teachers, ...students];
  const subjects = [
    ['algorithms', 'Алгоритмы и структуры данных'], ['networks', 'Компьютерные сети'],
    ['python', 'Программирование на Python'], ['quality', 'Тестирование программного обеспечения'],
  ].map(([key, name]) => ({ id: `demo-more-subject-${key}`, name: `${name} · демо`, version: 1 }));
  const rooms = [
    ['401 · учебная лаборатория', 24], ['402 · сетевой класс', 24],
    ['403 · практикум', 24], ['404 · проектная мастерская', 24],
  ].map(([name, capacity], index) => ({ id: `demo-more-room-${index + 1}`, name: `${name} · демо`, capacity, version: 1 }));
  const pairs = [
    [groups[0].id, 'demo-subject-db', profiles.teacherId, rooms[0].id, 'db'],
    [groups[0].id, subjects[3].id, teachers[3].id, rooms[0].id, 'quality'],
    [groups[1].id, subjects[0].id, teachers[0].id, rooms[1].id, 'algorithms'],
    [groups[1].id, subjects[2].id, teachers[2].id, rooms[1].id, 'python'],
    [groups[2].id, subjects[2].id, teachers[2].id, rooms[2].id, 'python'],
    [groups[2].id, subjects[0].id, teachers[0].id, rooms[2].id, 'algorithms'],
    [groups[3].id, subjects[1].id, teachers[1].id, rooms[3].id, 'networks'],
    [groups[3].id, subjects[3].id, teachers[3].id, rooms[3].id, 'quality'],
    ['demo-group-1', subjects[3].id, profiles.teacherId, rooms[0].id, 'quality'],
    ['demo-group-2', subjects[0].id, 'demo-teacher-2', rooms[1].id, 'algorithms'],
  ].map(([groupId, subjectId, teacherId, roomId, theme]) => ({ groupId, subjectId, teacherId, roomId, theme }));
  const teachingAssignments = pairs.map(({ teacherId, groupId, subjectId }) => ({ teacherId, groupId, subjectId }))
    .filter(pair => !(existing.teachingAssignments || []).some(old => old.teacherId === pair.teacherId && old.groupId === pair.groupId && old.subjectId === pair.subjectId));
  const earlier = Array.from({ length: 7 }, (_, index) => index - 7).filter(day => isWeekday(at(day))).slice(-4);
  const later = Array.from({ length: 14 }, (_, index) => index + 1).filter(day => isWeekday(at(day)));
  const days = [...earlier, 0, later[0], later[1], later[2], later[6], later.at(-1)];
  const lessons = [], occupied = [...existing.lessons];
  const hasConflict = (pair, startsAt, endsAt) => occupied.filter(lesson => lesson.status !== 'cancelled'
    && Date.parse(lesson.startsAt) < endsAt && Date.parse(lesson.endsAt) > startsAt
    && ['groupId', 'teacherId', 'roomId'].some(key => lesson[key] === pair[key]));
  function schedule(pair, requested) {
    let start = requested;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const conflicts = hasConflict(pair, start, start + 80 * minuteMs);
      if (!conflicts.length) return start;
      start = Math.max(...conflicts.map(item => Date.parse(item.endsAt))) + 20 * minuteMs;
      const local = new Date(start + 5 * 3600000);
      if (local.getUTCHours() >= 18) {
        const nextDate = local.toISOString().slice(0, 10);
        start = Date.parse(`${nextDate}T09:00:00+05:00`) + dayMs;
        while (!isWeekday(start)) start += dayMs;
      }
    }
    throw new Error('Не удалось разместить демонстрационные занятия без пересечений.');
  }
  days.forEach((day, dayIndex) => pairs.forEach((pair, pairIndex) => {
    // Different groups have two periods; shared teachers are shifted by the scheduler.
    const requested = at(day, pairIndex % 2 ? 10 : 9, pairIndex % 2 ? 40 : 0);
    const startsAt = schedule(pair, requested);
    const lesson = {
      id: `demo-more-lesson-${dayIndex + 1}-${pairIndex + 1}`,
      groupId: pair.groupId, subjectId: pair.subjectId, teacherId: pair.teacherId, roomId: pair.roomId,
      startsAt: iso(startsAt), endsAt: iso(startsAt + 80 * minuteMs),
      kind: ['Практика', 'Лабораторная', 'Лекция', 'Разбор проекта'][(dayIndex + pairIndex) % 4],
      note: 'Вымышленное занятие для демонстрации расписания, журнала и посещаемости.',
      status: 'scheduled', version: 1, attendanceVersion: 1,
    };
    lessons.push(lesson); occupied.push(lesson);
  }));
  lessons.sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  const topicTemplates = {
    db: [
      ['Нормализация каталога библиотеки', 'Выделите сущности книг, читателей и выдач. Уберите повторяющиеся данные и объясните нормализацию до третьей нормальной формы.', 'Опишите ключи и ограничения.', 'Приложите SQL-схему и две проверки связности.'],
      ['Отчёт по выданным книгам', 'Напишите запросы для активных выдач, популярных книг и читателей без текущих выдач. Объясните выбор типов JOIN.', 'Составьте три запроса.', 'Покажите работу фильтра даты и GROUP BY.'],
    ],
    algorithms: [
      ['Пошаговая сортировка массива', 'Разберите сортировку вставками для учебной последовательности. Покажите состояние массива после каждого прохода и число сравнений.', 'Запишите исходную последовательность.', 'Объясните сложность алгоритма и граничные случаи.'],
      ['Очередь обращений в поддержку', 'Опишите очередь заявок с добавлением, обработкой первой заявки и просмотром длины. Сравните очередь со стеком на конкретном сценарии.', 'Опишите операции и инварианты.', 'Проверьте пустую очередь и порядок обработки.'],
    ],
    networks: [
      ['Адресный план компьютерного класса', 'Разделите учебную сеть на подсети для двух кабинетов. Укажите маски, диапазоны доступных адресов, адрес сети и broadcast.', 'Составьте таблицу адресов.', 'Объясните, почему диапазоны не пересекаются.'],
      ['Диагностика сетевого подключения', 'Составьте последовательность диагностики: интерфейс, шлюз, IP-адрес, DNS и доступ к сервису. Для каждого шага укажите ожидаемый результат.', 'Опишите команды и проверяемые гипотезы.', 'Добавьте два примера неисправностей и способ их различить.'],
    ],
    python: [
      ['Обработка учебного CSV-файла', 'Спроектируйте обработку списка товаров: прочитайте строки, проверьте цену и количество, вычислите сумму. Некорректные строки выводите отдельно.', 'Опишите проверку значений.', 'Покажите результат для корректной и ошибочной строки.'],
      ['Словарь частот и фильтрация текста', 'Подсчитайте частоту слов в небольшом тексте без учёта регистра и знаков препинания. Выведите пять самых частых слов.', 'Объясните нормализацию текста.', 'Проверьте пустую строку и повторяющиеся пробелы.'],
    ],
    quality: [
      ['Тест-кейсы формы регистрации', 'Подготовьте проверки обязательных полей, формата почты, длины пароля и повторного нажатия кнопки. Ожидаемый результат должен быть проверяемым.', 'Опишите позитивный и негативные сценарии.', 'Добавьте граничные значения и восстановление после ошибки.'],
      ['Отчёт о проверке расписания', 'Проверьте добавление, редактирование и отмену занятия. Отдельно опишите пересечение по группе, преподавателю и аудитории.', 'Укажите предусловия и шаги.', 'Составьте один пример дефекта с фактическим и ожидаемым результатом.'],
    ],
  };
  const assignments = pairs.flatMap((pair, pairIndex) => topicTemplates[pair.theme].map((topic, topicIndex) => ({
    id: `demo-more-assignment-${pairIndex + 1}-${topicIndex + 1}`,
    groupId: pair.groupId, subjectId: pair.subjectId, teacherId: pair.teacherId,
    title: topic[0], type: topicIndex ? 'Лабораторная работа' : 'Практическая работа',
    description: `${topic[1]} Данные в примере вымышлены и предназначены для проверки проекта.`,
    steps: [topic[2], topic[3], 'Приложите текстовый или SQL-файл с решением и кратким выводом.'],
    dueAt: iso(at(topicIndex ? 3 + pairIndex % 5 : -1, 18)), version: 1,
  })));
  const files = {};
  function addFile(id, name, text) {
    files[id] = { name, mimeType: 'text/plain', text };
    return { id, name, mimeType: 'text/plain', bytes: new TextEncoder().encode(text).byteLength };
  }
  const allDemoStudents = [...existing.users, ...students].filter(user => user.role === 'student' && user.id.startsWith('demo-'));
  const roster = groupId => allDemoStudents.filter(user => user.groupId === groupId);
  const sampleSolution = (theme, variant) => {
    if (theme === 'db') return `CREATE TABLE books (\n  id INTEGER PRIMARY KEY,\n  title VARCHAR(160) NOT NULL\n);\nCREATE TABLE readers (\n  id INTEGER PRIMARY KEY,\n  full_name VARCHAR(120) NOT NULL\n);\nCREATE TABLE loans (\n  id INTEGER PRIMARY KEY,\n  book_id INTEGER NOT NULL REFERENCES books(id),\n  reader_id INTEGER NOT NULL REFERENCES readers(id),\n  returned_at TIMESTAMP\n);\n\nSELECT b.title, COUNT(l.id) AS loan_count\nFROM books b LEFT JOIN loans l ON l.book_id = b.id\nGROUP BY b.id, b.title\nORDER BY loan_count DESC;\n-- Вариант ${variant}: отдельно проверить книги без выдач.\n`;
    if (theme === 'algorithms') return `Исходные значения: ${[7 + variant, 2, 9, 1, 5].join(', ')}.\nСортировка вставками: переносим текущий элемент в отсортированную часть слева.\nИнвариант: перед проходом первые i элементов уже отсортированы.\nХудший случай: O(n²), дополнительная память O(1).\nОчередь обрабатывает обращения FIFO: добавление в конец, извлечение из начала.\nПроверки: пустая очередь, одно обращение, последовательность из пяти обращений.\n`;
    if (theme === 'networks') return `Учебная сеть: 192.168.${20 + variant}.0/24.\nКабинет A: /26, адреса .1–.62, broadcast .63.\nКабинет B: /26, адреса .65–.126, broadcast .127.\nПодсети не пересекаются; адрес сети и broadcast не назначаются компьютерам.\nДиагностика: состояние интерфейса → адрес/маска → ping шлюза → проверка DNS.\nЕсли IP доступен, а имя нет, отдельно проверяем DNS-сервер и ответ nslookup.\n`;
    if (theme === 'python') return `def total(rows):\n    result = 0\n    errors = []\n    for index, row in enumerate(rows, start=1):\n        try:\n            price = float(row['price'])\n            count = int(row['count'])\n            if price < 0 or count < 0:\n                raise ValueError('negative value')\n            result += price * count\n        except (KeyError, ValueError):\n            errors.append(index)\n    return result, errors\n\nПример: цена ${100 + variant * 10}, количество 2. Некорректную строку не включаем в сумму.\nДля финансовых расчётов предпочтителен Decimal; здесь приведён учебный пример.\n`;
    return `Тест-кейс ${variant}: сохранение формы.\nПредусловия: пользователь вошёл, форма открыта, обязательные поля доступны.\nШаги: заполнить корректные данные, нажать «Сохранить», обновить страницу.\nОжидается: сообщение об успехе, запись в списке, данные после обновления сохранены.\nНегативная проверка: отправить пустое обязательное поле. Ожидается пояснение рядом с полем.\nРасписание: одинаковые группа, преподаватель или аудитория при пересечении времени отклоняются.\nСмежные занятия без пересечения сохраняются. Отменённое занятие не занимает аудиторию.\n`;
  };
  const submissions = assignments.flatMap((assignment, assignmentIndex) => {
    const pair = pairs[Math.floor(assignmentIndex / 2)];
    return roster(assignment.groupId).slice(0, 4).map((student, index) => {
      const status = ['submitted', 'reviewed', 'revision', 'reviewed'][(index + assignmentIndex) % 4];
      const id = `demo-more-submission-${assignmentIndex + 1}-${index + 1}`;
      const text = `${pair.theme === 'db' ? '-- ' : ''}Вымышленная работа: ${student.name}.\n${pair.theme === 'db' ? '-- ' : ''}Задание: ${assignment.title}.\n\n${sampleSolution(pair.theme, assignmentIndex + index + 1)}`;
      return {
        id, assignmentId: assignment.id, studentId: student.id, status,
        submittedAt: iso(instant.getTime() - (60 + assignmentIndex * 45 + index * 17) * minuteMs),
        file: addFile(`${id}-file`, `demo-answer-${assignmentIndex + 1}-${index + 1}.${pair.theme === 'db' ? 'sql' : 'txt'}`, text),
        grade: status === 'reviewed' ? [5, 4, 3][(assignmentIndex + index) % 3] : null,
        comment: status === 'revision' ? 'Добавьте проверку граничного случая и поясните полученный результат.'
          : status === 'reviewed' ? ['Решение понятное, основные требования выполнены.', 'Добавьте короткий вывод и пример входных данных.', 'Логика верная; оформление примеров стоит уточнить.'][(assignmentIndex + index) % 3] : '',
        version: 1,
      };
    });
  });
  const grades = [], attendance = [];
  lessons.filter(lesson => Date.parse(lesson.endsAt) <= instant.getTime()).forEach((lesson, lessonIndex) => {
    roster(lesson.groupId).forEach((student, index) => {
      const status = ['present', 'present', 'present', 'late', 'present', 'absent', 'present', 'excused'][(lessonIndex + index) % 8];
      attendance.push({ lessonId: lesson.id, studentId: student.id, status });
      if (['present', 'late'].includes(status) && (lessonIndex + index) % 4 !== 0) grades.push({
        lessonId: lesson.id, studentId: student.id, grade: [5, 4, 4, 3, 5, 2][(lessonIndex + index) % 6], version: 1,
      });
    });
  });
  const materials = subjects.map((subject, index) => {
    const theme = ['algorithms', 'networks', 'python', 'quality'][index];
    const id = `demo-more-material-${index + 1}`;
    const file = addFile(`${id}-file`, `demo-guide-${theme}.txt`, `Учебный материал — вымышленный пример\n\n${subject.name}\n\n${sampleSolution(theme, index + 1)}\nПеред сдачей: проверьте условия, подпишите примеры и сформулируйте вывод.\n`);
    return { id, subjectId: subject.id, title: `Памятка: ${subject.name}`, fileId: file.id };
  });
  const announcements = [
    { id: 'demo-more-notice-expansion', title: 'Больше примеров для проверки проекта', body: 'Добавлены четыре демонстрационные группы, новые предметы, расписание и работы с разными статусами. Все новые имена и данные вымышлены.', publishedAt: iso(instant) },
    { id: 'demo-more-notice-workflow', title: 'Попробуйте полный учебный сценарий', body: 'Преподаватель может оценить работу, вернуть её на доработку и сохранить посещаемость. Студент видит только свои результаты.', publishedAt: iso(instant.getTime() - 60 * minuteMs) },
    { id: 'demo-more-notice-schedule', title: 'Расписание на ближайшие недели', body: 'В демонстрационном расписании есть прошедшие и будущие занятия. Используйте выбор даты и недельный вид для просмотра разных групп.', publishedAt: iso(at(-1, 12)) },
  ];
  return {
    seedId: 'studyhub-fictional-demo-v2', seedDate, profiles, files,
    data: { users, groups, subjects, rooms, teachingAssignments, lessons, assignments, submissions, grades, attendance, materials, announcements },
  };
}
