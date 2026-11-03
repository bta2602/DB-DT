'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Bootstrap, Role, Session, User } from '@/lib/studyhub/api-contract';
import { emptyData } from '@/lib/studyhub/client-utils';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type RequestOptions = { method?: string; body?: unknown | FormData };
type StudyHubContextValue = {
  user: User | null;
  data: Bootstrap;
  ready: boolean;
  error: string;
  now: number;
  demoEnabled: boolean;
  switchingRole: boolean;
  request: <T = unknown>(path: string, options?: RequestOptions) => Promise<T>;
  refresh: () => Promise<void>;
  reloadSession: () => Promise<Session>;
  switchRole: (role: Role) => Promise<Session>;
  mutate: (method: string, path: string, body: unknown) => Promise<void>;
  notify: (message: string) => void;
  downloadFile: (id: string, name?: string) => Promise<void>;
};

const StudyHubContext = createContext<StudyHubContextValue | null>(null);

function validateData(data: Bootstrap) {
  if (Object.keys(emptyData()).some((key) => !Array.isArray(data[key as keyof Bootstrap]))) {
    throw new Error('Не удалось прочитать учебные данные.');
  }
  return data;
}

export function StudyHubProvider({
  children,
  initialSession,
  initialData,
  initialNow,
}: {
  children: ReactNode;
  initialSession: Session | null;
  initialData: Bootstrap;
  initialNow: number;
}) {
  const [now, setNow] = useState(initialNow);
  const [user, setUser] = useState<User | null>(initialSession?.user || null);
  const [data, setData] = useState<Bootstrap>(initialData);
  const [ready, setReady] = useState(Boolean(initialSession));
  const [demoEnabled, setDemoEnabled] = useState(Boolean(initialSession?.demoEnabled));
  const [switchingRole, setSwitchingRole] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const token = useRef(initialSession?.csrfToken || '');
  const loadEpoch = useRef(0);
  const startup = useRef<Promise<Session | void> | null>(null);
  const roleSwitch = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const request = useCallback(
    async <T = unknown,>(path: string, options: RequestOptions = {}): Promise<T> => {
      if (!path.startsWith('/api/')) throw new ApiError('Некорректный адрес запроса.');
      const method = options.method || 'GET';
      const multipart = options.body instanceof FormData;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-CSRF-Token'] = token.current;

      let response: Response;
      try {
        response = await fetch(path, {
          method,
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(multipart ? 60000 : 20000),
          body:
            options.body === undefined
              ? undefined
              : multipart
                ? (options.body as FormData)
                : JSON.stringify(options.body),
        });
      } catch {
        throw new ApiError(
          'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
        );
      }

      const result =
        response.status === 204
          ? {}
          : await response.json().catch(() => {
              throw new ApiError('Сервер вернул некорректный ответ.', response.status);
            });
      if (!response.ok) {
        if (response.status === 401) {
          loadEpoch.current++;
          setUser(null);
          setData(emptyData());
          token.current = '';
          // Get a guest token so the login form can be used after a session expires.
          if (path !== '/api/session') {
            try {
              const recovery = await fetch('/api/session', {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(10000),
              });
              if (recovery.ok) {
                const session: Session = await recovery.json();
                token.current = session.csrfToken;
                setDemoEnabled(Boolean(session.demoEnabled));
              }
            } catch {
              setError('Не удалось обновить сессию. Нажмите «Повторить».');
            }
          }
        }
        throw new ApiError(
          result.error?.message || 'Не удалось выполнить действие.',
          response.status,
          result.error?.fields || {},
        );
      }
      if (typeof result.csrfToken === 'string') token.current = result.csrfToken;
      if (path === '/api/auth/logout') {
        loadEpoch.current++;
        setUser(null);
        setData(emptyData());
      }
      return result as T;
    },
    [],
  );

  const reloadSession = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    let session: Session | null = null;
    try {
      session = await request<Session>('/api/session');
      if (epoch !== loadEpoch.current) return session;
      const next = session.user
        ? validateData(await request<Bootstrap>('/api/bootstrap'))
        : emptyData();
      if (epoch !== loadEpoch.current) return session;
      // Replace the account and its records together after login or role switching.
      setUser(session.user);
      setData(next);
      setDemoEnabled(Boolean(session.demoEnabled));
      setError('');
      return session;
    } catch (cause) {
      if (epoch === loadEpoch.current) {
        setUser(session?.user || null);
        setData(emptyData());
        if (session) setDemoEnabled(Boolean(session.demoEnabled));
        setError(cause instanceof Error ? cause.message : 'Не удалось обновить данные.');
      }
      throw cause;
    } finally {
      if (epoch === loadEpoch.current) setReady(true);
    }
  }, [request]);

  // Saving a record only needs new data; the authenticated session stays the same.
  const refresh = useCallback(async () => {
    if (!user || roleSwitch.current) return;
    const epoch = ++loadEpoch.current;
    try {
      const next = validateData(await request<Bootstrap>('/api/bootstrap'));
      if (epoch !== loadEpoch.current) return;
      setData(next);
      setUser((current) =>
        current ? next.users.find((item) => item.id === current.id) || current : null,
      );
      setError('');
    } catch (cause) {
      if (epoch === loadEpoch.current) {
        setError(cause instanceof Error ? cause.message : 'Не удалось обновить данные.');
      }
      throw cause;
    }
  }, [request, user]);

  useEffect(() => {
    if (!initialSession && !startup.current) {
      startup.current = reloadSession().catch((cause) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сессию.');
      });
    }
  }, [initialSession, reloadSession]);

  const switchRole = useCallback(
    async (role: Role) => {
      if (roleSwitch.current) throw new ApiError('Дождитесь переключения роли.');
      roleSwitch.current = true;
      setSwitchingRole(true);
      loadEpoch.current++;
      try {
        await request('/api/auth/demo', { method: 'POST', body: { role } });
        return await reloadSession();
      } finally {
        roleSwitch.current = false;
        setSwitchingRole(false);
      }
    },
    [request, reloadSession],
  );

  const mutate = useCallback(
    async (method: string, path: string, body: unknown) => {
      await request(path, { method, body });
      try {
        await refresh();
      } catch {
        setError('Изменение сохранено, но список не обновился. Нажмите «Обновить данные».');
      }
    },
    [request, refresh],
  );

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);

  const downloadFile = useCallback(async (id: string, fallbackName = 'material') => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new ApiError('Файл недоступен или у вас нет доступа.', response.status);
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="([^"]+)"/i)?.[1];
    let name = plainName || fallbackName;
    if (encodedName) {
      try {
        name = decodeURIComponent(encodedName);
      } catch {
        /* Keep the safe fallback. */
      }
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  return (
    <StudyHubContext.Provider
      value={{
        user,
        data,
        ready,
        error,
        now,
        demoEnabled,
        switchingRole,
        request,
        refresh,
        reloadSession,
        switchRole,
        mutate,
        notify,
        downloadFile,
      }}
    >
      {children}
      <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">
        {notice}
      </div>
    </StudyHubContext.Provider>
  );
}

export function useStudyHub() {
  const context = useContext(StudyHubContext);
  if (!context) throw new Error('StudyHubProvider is required');
  return context;
}
