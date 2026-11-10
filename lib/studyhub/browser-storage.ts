export type StorageRead<T> = {
  value: T;
  status: 'loaded' | 'empty' | 'invalid' | 'unavailable';
};

export type BrowserStorageStatus = StorageRead<unknown>['status'] | 'loading' | 'saved' | 'error';

export function storageKey(userId: string, area: string, entityId?: string) {
  if (!userId) throw new Error('Для личных данных нужен пользователь.');
  const parts = ['studyhub', 'v1', 'user', userId, area];
  if (entityId !== undefined) parts.push(entityId);
  return parts.map(encodeURIComponent).join(':');
}

export function readLocal<T>(
  key: string,
  validate: (value: unknown) => value is T,
  fallback: T,
): StorageRead<T> {
  if (typeof window === 'undefined') return { value: fallback, status: 'unavailable' };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return { value: fallback, status: 'unavailable' };
  }
  if (raw === null) return { value: fallback, status: 'empty' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('value' in parsed) ||
      !validate(parsed.value)
    ) {
      return { value: fallback, status: 'invalid' };
    }
    return { value: parsed.value, status: 'loaded' };
  } catch {
    return { value: fallback, status: 'invalid' };
  }
}

export function writeLocal<T>(key: string, value: T) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), value }),
    );
    return true;
  } catch {
    return false;
  }
}

export function removeLocal(key: string) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export type BrowserStorageSnapshot<T> = {
  value: T;
  status: BrowserStorageStatus;
  ready: boolean;
};

/**
 * One mounted consumer's lifecycle. Construction and server snapshots never
 * access the browser. Only explicit edits write; restoring cannot erase a draft.
 */
export function createBrowserStore<T>(
  key: string | null,
  validate: (value: unknown) => value is T,
  fallback: T,
) {
  const initial: BrowserStorageSnapshot<T> = { value: fallback, status: 'loading', ready: false };
  let snapshot = initial;
  let active = false;
  const listeners = new Set<() => void>();
  const publish = (next: BrowserStorageSnapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      active = true;
      const restored: StorageRead<T> = key
        ? readLocal(key, validate, fallback)
        : { value: fallback, status: 'unavailable' };
      publish({ ...restored, ready: true });
    },
    stop() {
      active = false;
    },
    setValue(next: T | ((previous: T) => T)) {
      if (!active || !snapshot.ready) return;
      const value =
        typeof next === 'function' ? (next as (previous: T) => T)(snapshot.value) : next;
      if (!validate(value)) {
        publish({ ...snapshot, status: 'error' });
        return;
      }
      // Write immediately, before a dialog closes, navigation or account change.
      const saved = key !== null && writeLocal(key, value);
      publish({ value, status: saved ? 'saved' : 'error', ready: true });
    },
    clear() {
      if (!active || !snapshot.ready) return;
      if (key !== null && removeLocal(key)) {
        publish({ value: fallback, status: 'empty', ready: true });
      } else {
        // Keep the visible draft if removal was denied, so it can be copied.
        publish({ ...snapshot, status: 'error' });
      }
    },
    reset() {
      if (!active || !snapshot.ready) return;
      const removed = key !== null && removeLocal(key);
      // Filters must still reset in memory when storage is blocked. Drafts use
      // clear() instead, retaining their text if durable removal fails.
      publish({ value: fallback, status: removed ? 'empty' : 'error', ready: true });
    },
  };
}

export type AssignmentProgress = {
  note: string;
  completed: number[];
  stepsSignature: string;
};

export function isAssignmentProgress(value: unknown): value is AssignmentProgress {
  if (!value || typeof value !== 'object') return false;
  if (!('note' in value) || typeof value.note !== 'string') return false;
  if (!('stepsSignature' in value) || typeof value.stepsSignature !== 'string') return false;
  if (!('completed' in value) || !Array.isArray(value.completed)) return false;
  try {
    const steps: unknown = JSON.parse(value.stepsSignature);
    return (
      Array.isArray(steps) &&
      steps.every((step) => typeof step === 'string') &&
      value.completed.every(
        (index) => Number.isInteger(index) && index >= 0 && index < steps.length,
      ) &&
      new Set(value.completed).size === value.completed.length
    );
  } catch {
    return false;
  }
}

/** Updated instructions retain the student's note, but never reuse stale ticks. */
export function progressForSteps(value: AssignmentProgress, steps: string[]): AssignmentProgress {
  const stepsSignature = JSON.stringify(steps);
  return value.stepsSignature === stepsSignature
    ? value
    : { note: value.note, completed: [], stepsSignature };
}

export function isFavoriteIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(value).size === value.length
  );
}

export function availableFavorites(ids: string[], materials: { id: string }[]): string[] {
  const available = new Set(materials.map((material) => material.id));
  return [...new Set(ids)].filter((id) => available.has(id));
}
