// Технические ID сохраняются: на них ссылаются оценки, работы и переключатель ролей.
export function cleanText(value) {
  return String(value)
    .replace(/\s*·\s*демо/giu, '')
    .replace(/Администратор демо/giu, 'Ерлан Бекмуратов')
    .replace(/ДЕМОНСТРАЦИОННАЯ РАБОТА\s*[—–-]\s*вымышленные данные/giu, 'Практическая работа')
    .replace(
      /Вымышленная работа для демонстрации StudyHUB/giu,
      'Практическая работа по базам данных',
    )
    .replace(/Демонстрационная работа:?\s*(?:данные вымышлены)?/giu, 'Практическая работа')
    .replace(/Демонстрационный материал/giu, 'Учебный материал')
    .replace(/Демонстрационное занятие:\s*/giu, '')
    .replace(/демонстрационную схему/giu, 'схему учебного центра')
    .replace(/\s*Все данные в примере вымышлены\./giu, '')
    .replace(/\bdemo[-_ ]*/giu, '')
    .replace(/демонстрационн[а-яё]*/giu, 'учебный')
    .replace(/демонстраци[а-яё]*/giu, 'занятия')
    .replace(/демо/giu, '')
    .trim();
}

export const campusNotices = {
  'demo-notice-fiction': {
    title: 'График консультаций на неделю',
    body: 'Консультации по базам данных проходят во вторник и четверг с 14:00 до 15:00 в аудитории 201. Подготовьте вопросы и черновик работы.',
  },
  'demo-notice-review': {
    title: 'Оформление практических работ',
    body: 'В начале файла укажите фамилию, группу и номер работы. Проверяйте названия таблиц и подписывайте результаты запросов перед отправкой.',
  },
  'demo-notice-student': {
    title: 'Подготовка к промежуточной аттестации',
    body: 'Проверьте результаты в разделе «Предметы». Незавершённые работы можно обсудить с преподавателем на консультации до конца недели.',
  },
};

export function cleanSeedSnapshot(snapshot) {
  const visible = new Set([
    'name',
    'title',
    'description',
    'body',
    'note',
    'comment',
    'text',
    'email',
  ]);
  function clean(value, key = '') {
    if (typeof value === 'string') return visible.has(key) ? cleanText(value) : value;
    if (Array.isArray(value))
      return value.map((item) =>
        key === 'steps' && typeof item === 'string' ? cleanText(item) : clean(item, key),
      );
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, clean(item, name)]),
    );
  }
  const result = clean(snapshot);
  for (const notice of result.data.announcements)
    Object.assign(notice, campusNotices[notice.id] || {});
  for (const file of Object.values(result.files)) file.mimeType = 'text/plain';
  for (const work of result.data.submissions) {
    const file = result.files[work.file.id];
    if (file)
      work.file = {
        ...work.file,
        name: file.name,
        mimeType: file.mimeType,
        bytes: new TextEncoder().encode(file.text).length,
      };
  }
  return result;
}
