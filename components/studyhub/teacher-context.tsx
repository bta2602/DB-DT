'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Mark } from '@/lib/studyhub/api-contract';
import { useStudyHub } from './context';
export type ReviewDraft = { grade: Mark | null; comment: string; version: number };
type DraftContextValue = {
  reviews: Record<string, ReviewDraft>;
  setReview: (id: string, value: ReviewDraft | null) => void;
};
const DraftContext = createContext<DraftContextValue | null>(null);

function DraftProvider({ children }: { children: ReactNode }) {
  const [reviews, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const dirty = Object.keys(reviews).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const value: DraftContextValue = {
    reviews,
    setReview(id, value) {
      setReviewDrafts((previous) => {
        const next = { ...previous };
        if (value) next[id] = value;
        else delete next[id];
        return next;
      });
    },
  };
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/** Keep teacher drafts when Next.js switches pages; clear them on account changes. */
export function TeacherWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useStudyHub();
  return <DraftProvider key={user?.id || 'guest'}>{children}</DraftProvider>;
}

export function useTeacherDrafts() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('TeacherWorkspaceProvider is required.');
  return context;
}
