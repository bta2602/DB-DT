'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  discardPublishedReviewDraft,
  isReviewDrafts,
  type ReviewDraft,
} from '@/lib/studyhub/teacher-filters';
import { useStudyHub } from './context';
import { useBrowserStorage } from './use-browser-storage';
export type { ReviewDraft } from '@/lib/studyhub/teacher-filters';
type DraftContextValue = {
  reviews: Record<string, ReviewDraft>;
  setReview: (id: string, value: ReviewDraft | null) => void;
  finishReview: (id: string, published: ReviewDraft) => void;
  ready: boolean;
  status: ReturnType<typeof useBrowserStorage>['status'];
};
const DraftContext = createContext<DraftContextValue | null>(null);
const emptyReviews: Record<string, ReviewDraft> = {};

function DraftProvider({ children }: { children: ReactNode }) {
  const { user } = useStudyHub();
  const storage = useBrowserStorage({
    userId: user?.role === 'teacher' ? user.id : null,
    area: 'reviews',
    fallback: emptyReviews,
    validate: isReviewDrafts,
  });
  const dirty = Object.keys(storage.value).length > 0;
  useEffect(() => {
    if (!dirty || (storage.status !== 'error' && storage.status !== 'unavailable')) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, storage.status]);
  const value: DraftContextValue = {
    reviews: storage.value,
    ready: storage.ready,
    status: storage.status,
    setReview(id, value) {
      storage.setValue((previous) => {
        const next = { ...previous };
        if (value) next[id] = value;
        else delete next[id];
        return next;
      });
    },
    finishReview(id, published) {
      storage.setValue((previous) => discardPublishedReviewDraft(previous, id, published));
    },
  };
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/** Remount before rendering another account; browser keys also include the user ID. */
export function TeacherWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useStudyHub();
  return <DraftProvider key={user?.id || 'guest'}>{children}</DraftProvider>;
}

export function useTeacherDrafts() {
  const context = useContext(DraftContext);
  if (!context) throw new Error('TeacherWorkspaceProvider is required.');
  return context;
}
