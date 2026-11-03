'use client';

import dynamic from 'next/dynamic';
import { useStudyHub } from './context';

// На главной загружаем только кабинет выбранной роли.
const StudentToday = dynamic(() => import('./student-pages').then((page) => page.StudentToday));
const TeacherToday = dynamic(() => import('./teacher-pages').then((page) => page.TeacherToday));

export function TodayPage() {
  const { user } = useStudyHub();
  return user?.role === 'teacher' ? <TeacherToday /> : <StudentToday />;
}
