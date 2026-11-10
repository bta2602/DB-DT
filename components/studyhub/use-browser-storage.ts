'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createBrowserStore, storageKey } from '../../lib/studyhub/browser-storage';

export type { BrowserStorageStatus } from '../../lib/studyhub/browser-storage';

export function useBrowserStorage<T>({
  userId,
  area,
  entityId,
  fallback,
  validate,
}: {
  userId: string | null | undefined;
  area: string;
  entityId?: string;
  fallback: T;
  validate: (value: unknown) => value is T;
}) {
  const key = userId ? storageKey(userId, area, entityId) : null;
  const [binding, setBinding] = useState(() => ({
    key,
    store: createBrowserStore(key, validate, fallback),
  }));
  let store = binding.store;
  if (binding.key !== key) {
    // Reset during render so an account switch cannot paint the previous user.
    // Inline validator/fallback objects do not reset a mounted consumer's draft.
    store = createBrowserStore(key, validate, fallback);
    setBinding({ key, store });
  }
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => {
    store.start();
    return store.stop;
  }, [store]);
  return { ...snapshot, setValue: store.setValue, clear: store.clear, reset: store.reset };
}
