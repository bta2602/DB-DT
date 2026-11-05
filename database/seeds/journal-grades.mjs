// Подготавливает единые отметки для новых учебных наборов, не меняя числовую шкалу.
export function journalGrades(grades, attendance) {
  const result = new Map(
    grades.map((row) => [
      `${row.lessonId}:${row.studentId}`,
      { ...row, status: row.status ?? (row.grade === null ? 'unmarked' : 'graded') },
    ]),
  );
  for (const mark of attendance) {
    if (!['absent', 'excused'].includes(mark.status)) continue;
    const key = `${mark.lessonId}:${mark.studentId}`;
    const old = result.get(key);
    if (old?.grade !== null && old?.grade !== undefined) continue;
    if (old?.status === 'not_required') continue;
    result.set(key, {
      lessonId: mark.lessonId,
      studentId: mark.studentId,
      grade: null,
      status: 'absent',
      version: old?.version ?? 1,
    });
  }
  return [...result.values()];
}
