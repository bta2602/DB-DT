/**
 * Existing records retain their original database type and linked lesson.
 * The journal and assignment lists use these three assessment categories.
 * @param {string} value
 * @returns {'lecture' | 'practice' | 'srsp' | null}
 */
export function recognizedAssessmentKind(value) {
  const kind = value.trim().toLowerCase();
  if (['lecture', 'лекция', 'дәріс'].includes(kind)) return 'lecture';
  if (
    ['srsp', 'срсп', 'осөж', 'lab', 'laboratory'].includes(kind) ||
    /^(?:лабораторн|самостоятельн|зертханалық|өзіндік|laboratory |independent |supervised independent )/u.test(
      kind,
    )
  )
    return 'srsp';
  if (
    ['practice', 'практика', 'практическая работа', 'проектная работа', 'мини-проект'].includes(
      kind,
    )
  )
    return 'practice';
  return null;
}

/** @param {string} value */
export function assessmentKind(value) {
  return recognizedAssessmentKind(value) ?? 'practice';
}
