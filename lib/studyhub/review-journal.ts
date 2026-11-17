type ReviewRecord = {
  assignment: { id: string };
  student: { id: string };
  work?: { id: string; status: string };
};

/** Pass only records already scoped to the current teacher. A URL never grants access. */
export function reviewedJournalTarget<T extends ReviewRecord>(
  records: readonly T[],
  assignmentId: string,
  studentId: string,
  reviewId: string,
): T | undefined {
  if (!assignmentId || !studentId || !reviewId) return undefined;
  return records.find(
    (record) =>
      record.assignment.id === assignmentId &&
      record.student.id === studentId &&
      record.work?.id === reviewId &&
      record.work.status === 'reviewed',
  );
}

export function reviewJournalHref(assignmentId: string, studentId: string, reviewId: string) {
  return '/journal?' + new URLSearchParams({ assignmentId, studentId, reviewId }).toString();
}
