import { lessonSlots } from '../../lib/studyhub/lesson-rules.mjs';

export const SUBJECTS = {
  math: 'Прикладная математика',
  stats: 'Теория вероятностей и статистика',
  python: 'Python',
  algorithms: 'Алгоритмы и структуры данных',
  web: 'Веб-разработка',
  databases: 'Базы данных',
  analytics: 'Анализ данных',
  ml: 'Машинное обучение',
  os: 'Операционные системы',
  networks: 'Компьютерные сети',
  security: 'Информационная безопасность',
  ui: 'Проектирование интерфейсов',
  testing: 'Тестирование ПО',
  projects: 'Управление IT-проектами',
  english: 'Английский язык в IT',
};

// Dates are interpreted in the college's fixed UTC+5 timezone.
export function academicYearForDate(value = new Date()) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('Некорректная дата.');
  const local = new Date(instant.getTime() + 5 * 60 * 60 * 1000);
  return local.getUTCFullYear() - (local.getUTCMonth() < 8 ? 1 : 0);
}

export function courseForDate(intakeYear, value = new Date()) {
  if (!Number.isInteger(intakeYear)) throw new Error('Некорректный год поступления.');
  return academicYearForDate(value) - intakeYear + 1;
}

export const ACADEMIC_SLOTS = lessonSlots.map(({ id, start, end }) => ({
  id,
  startsAt: start,
  endsAt: end,
}));

const BLOCKS = [
  ['math', 'stats'],
  ['python', 'algorithms', 'web'],
  ['databases', 'analytics', 'ml'],
  ['os', 'networks', 'security'],
  ['ui', 'testing', 'projects'],
  ['english'],
];

const CORE = ['python', 'math', 'algorithms', 'english'];

const CURRICULA = {
  IS: {
    1: [...CORE, 'databases'],
    2: ['databases', 'web', 'ui', 'algorithms', 'testing'],
    3: ['databases', 'web', 'testing', 'projects', 'security'],
  },
  VTIPO: {
    1: [...CORE, 'os'],
    2: ['os', 'networks', 'algorithms', 'databases', 'python'],
    3: ['os', 'networks', 'security', 'testing', 'projects'],
  },
  DS: {
    1: [...CORE, 'stats'],
    2: ['stats', 'databases', 'python', 'analytics', 'algorithms'],
    3: ['ml', 'analytics', 'stats', 'databases', 'projects'],
  },
};

export function createAcademicPlan(academicYear = 2026) {
  if (!Number.isInteger(academicYear) || academicYear < 2024) {
    throw new Error('Некорректный учебный год.');
  }

  const groups = [];
  const prefix = { IS: 'ИС', VTIPO: 'ВТиПО', DS: 'DS' };

  for (const program of Object.keys(prefix)) {
    for (const intakeYear of [academicYear - 2, academicYear - 1, academicYear]) {
      for (const language of ['kk', 'ru']) {
        const suffix = language === 'kk' ? 'А' : 'Б';

        groups.push({
          key: `${program}-${intakeYear}-${language}`,
          program,
          intakeYear,
          language,
          course: academicYear - intakeYear + 1,
          name: `${prefix[program]}-${String(intakeYear).slice(-2)}${suffix}`,
        });
      }
    }
  }

  const teachers = BLOCKS.flatMap((subjectCodes, block) =>
    Array.from({ length: 3 }, (_, index) => ({
      key: `teacher-profile-${block + 1}-${index + 1}`,
      subjectCodes: [...subjectCodes],
      languages: index === 0 ? ['kk'] : index === 1 ? ['ru'] : ['kk', 'ru'],
    })),
  );

  const types = [
    'ordinary',
    'ordinary',
    'lecture',
    'lecture',
    'computer',
    'computer',
    'ordinary',
    'ordinary',
    'lecture',
    'lecture',
    'computer',
    'computer',
    'laboratory',
    'laboratory',
    'computer',
    'computer',
    'computer',
    'computer',
    'laboratory',
    'laboratory',
    'computer',
    'computer',
    'ordinary',
    'ordinary',
  ];

  const rooms = types.map((type, index) => {
    const floor = Math.floor(index / 6) + 1;
    const number = String(floor * 100 + (index % 6) + 1);

    return {
      key: `room-${number}`,
      number,
      floor,
      type,
      capacity: type === 'lecture' ? 60 : type === 'ordinary' ? 30 : 24,
    };
  });

  const students = groups.flatMap((group) =>
    Array.from({ length: 20 }, (_, index) => ({
      key: `student-${group.key}-${index + 1}`,
      groupKey: group.key,
      language: group.language,
    })),
  );

  const groupSubjects = groups.flatMap((group) =>
    CURRICULA[group.program][group.course].map((subjectCode) => ({
      groupKey: group.key,
      subjectCode,
      academicYear,
      semester: 1,
    })),
  );

  return {
    groups,
    teachers,
    rooms,
    students,
    groupSubjects,
    subjects: SUBJECTS,
  };
}
