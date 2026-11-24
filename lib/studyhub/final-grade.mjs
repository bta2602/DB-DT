/** A period or exam score has at most two decimal places on the 0–100 scale.
 * @param {unknown} score
 * @returns {score is number}
 */
export function isPeriodScore(score) {
  return (
    typeof score === 'number' &&
    score >= 0 &&
    score <= 100 &&
    Math.round(score * 100) / 100 === score
  );
}

/** @param {{r1: number | null, r2: number | null, examScore: number | null}} marks */
export function finalGradeFor({ r1, r2, examScore }) {
  if (!isPeriodScore(r1) || !isPeriodScore(r2) || !isPeriodScore(examScore)) return null;

  // The two ratings each contribute 30%, and the exam contributes 40%.
  // Weight integer hundredths so even half-hundredth averages retain their precision.
  const ratings = Math.round(r1 * 100) + Math.round(r2 * 100);
  const exam = Math.round(examScore * 100);
  return (3 * ratings + 4 * exam) / 1000;
}
