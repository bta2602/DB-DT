import { PolicyError } from './policy.mjs';
import { isPeriodScore } from './final-grade.mjs';

export const periodScoreFields = ['rk1', 'r1', 'rk2', 'r2'];
export const periodMarksFields = [
  'groupId',
  'subjectId',
  'studentId',
  'academicYear',
  'semester',
  ...periodScoreFields,
  'examScore',
  'version',
];

export function validatePeriodMarks(input) {
  const invalid = (field, message) => {
    throw new PolicyError(422, 'INVALID_PERIOD_MARKS', message, { [field]: message });
  };
  for (const field of ['groupId', 'subjectId', 'studentId']) {
    if (typeof input[field] !== 'string' || !input[field] || input[field].length > 100)
      invalid(field, 'Выберите существующие группу, предмет и студента.');
  }
  if (
    !Number.isInteger(input.academicYear) ||
    input.academicYear < 1900 ||
    input.academicYear > 9999
  )
    invalid('academicYear', 'Укажите год начала учебного года.');
  if (![1, 2].includes(input.semester)) invalid('semester', 'Выберите первый или второй семестр.');
  for (const field of [...periodScoreFields, 'examScore']) {
    if (field === 'examScore' && !Object.hasOwn(input, field)) continue;
    const score = input[field];
    if (score === null) continue;
    if (!isPeriodScore(score))
      invalid(
        field,
        'Введите балл от 0 до 100, не более двух знаков после запятой, или очистите поле.',
      );
  }
  if (!Number.isSafeInteger(input.version) || input.version < 0)
    invalid('version', 'Передайте версию записи, для новой записи — 0.');
  return input;
}
