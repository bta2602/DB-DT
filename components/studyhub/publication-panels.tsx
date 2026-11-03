'use client';

import { useState, type FormEvent } from 'react';
import { allowedSubmissionExtensions, maxSubmissionBytes } from '@/lib/studyhub/api-contract';
import { formatDate } from '@/lib/studyhub/client-utils';
import { useStudyHub } from './context';
import { EmptyState, Field, Icon, Modal } from './shared';

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Не удалось сохранить изменения.';

function DeletePublication({
  kind,
  id,
  title,
  onClose,
}: {
  kind: 'announcements' | 'materials';
  id: string;
  title: string;
  onClose: () => void;
}) {
  const { mutate, notify } = useStudyHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await mutate('DELETE', `/api/${kind}/${encodeURIComponent(id)}`, {});
      notify(kind === 'materials' ? 'Материал удалён.' : 'Объявление удалено.');
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Удалить публикацию?"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>«{title}» больше не будет доступно в учебном пространстве.</p>
      {error && (
        <p className="error-text mt" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Оставить
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? 'Удаляем…' : 'Удалить'}
        </button>
      </div>
    </Modal>
  );
}

function AnnouncementForm({ onClose }: { onClose: () => void }) {
  const { mutate, notify } = useStudyHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    const body = String(form.get('body') || '').trim();
    if (!title || !body) {
      setError('Заполните заголовок и текст объявления.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate('POST', '/api/announcements', { title, body });
      notify('Объявление опубликовано.');
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Новое объявление"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <Field label="Заголовок">
          <input
            name="title"
            required
            maxLength={120}
            disabled={busy}
            placeholder="Например, встреча учебной группы"
          />
        </Field>
        <Field label="Текст объявления">
          <textarea
            name="body"
            required
            maxLength={3000}
            disabled={busy}
            placeholder="Важная информация для студентов и преподавателей"
          />
        </Field>
        <p className="small muted">Объявление увидят все пользователи StudyHUB.</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Публикуем…' : 'Опубликовать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AnnouncementsPanel() {
  const { data, user } = useStudyHub();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = data.announcements.find((item) => item.id === deletingId);
  const canManage = user?.role === 'admin';
  const announcements = [...data.announcements].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <section className="card card-pad mt">
      <div className="section-head">
        <h2>Объявления</h2>
        {canManage && (
          <button type="button" className="button small" onClick={() => setCreating(true)}>
            <Icon name="plus" className="sm" />
            Добавить объявление
          </button>
        )}
      </div>
      {announcements.length ? (
        announcements.map((item) => (
          <article className="notice" key={item.id}>
            <div className="flex between">
              <h3>{item.title}</h3>
              {canManage && (
                <button
                  type="button"
                  className="button small"
                  aria-label={`Удалить объявление: ${item.title}`}
                  onClick={() => setDeletingId(item.id)}
                >
                  Удалить
                </button>
              )}
            </div>
            <p className="preserve-lines">{item.body}</p>
            <time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time>
          </article>
        ))
      ) : (
        <EmptyState
          title="Новых объявлений нет"
          description={
            canManage
              ? 'Опубликуйте важное сообщение для учебного пространства.'
              : 'Важные сообщения появятся здесь.'
          }
        />
      )}
      {creating && <AnnouncementForm onClose={() => setCreating(false)} />}
      {deleting && (
        <DeletePublication
          kind="announcements"
          id={deleting.id}
          title={deleting.title}
          onClose={() => setDeletingId(null)}
        />
      )}
    </section>
  );
}

function MaterialForm({ onClose }: { onClose: () => void }) {
  const { data, user, mutate, notify } = useStudyHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const subjects = data.subjects.filter((subject) =>
    data.teachingAssignments.some(
      (pair) => pair.teacherId === user?.id && pair.subjectId === subject.id,
    ),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    const title = String(form.get('title') || '').trim();
    const extension = file instanceof File ? file.name.split('.').pop()?.toLowerCase() : '';
    if (!title) {
      setError('Введите название материала.');
      return;
    }
    if (!(file instanceof File) || !file.size) {
      setError('Выберите непустой файл.');
      return;
    }
    if (file.size > maxSubmissionBytes) {
      setError('Файл больше 3 МБ.');
      return;
    }
    if (!allowedSubmissionExtensions.some((allowed) => allowed === extension)) {
      setError('Этот формат не поддерживается.');
      return;
    }
    form.set('title', title);
    setBusy(true);
    setError('');
    try {
      await mutate('POST', '/api/materials', form);
      notify('Материал опубликован.');
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Добавить учебный материал"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <Field label="Название материала">
          <input
            name="title"
            required
            maxLength={120}
            disabled={busy}
            placeholder="Например, конспект первой лекции"
          />
        </Field>
        <Field label="Предмет">
          <select name="subjectId" required disabled={busy}>
            {subjects.map((subject) => (
              <option value={subject.id} key={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Файл материала">
          <input
            name="file"
            type="file"
            required
            disabled={busy}
            accept={allowedSubmissionExtensions.map((extension) => `.${extension}`).join(',')}
            aria-describedby="material-file-hint"
          />
        </Field>
        <p className="small muted" id="material-file-hint">
          PDF, DOCX, ZIP, SQL, TXT или изображение · до 3 МБ. Студенты найдут файл в разделе
          «Предметы».
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="button primary" disabled={busy || !subjects.length}>
            {busy ? 'Загружаем…' : 'Опубликовать материал'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MaterialsPanel() {
  const { data, user, downloadFile, notify } = useStudyHub();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const subjects = data.subjects.filter((subject) =>
    data.teachingAssignments.some(
      (pair) => pair.teacherId === user?.id && pair.subjectId === subject.id,
    ),
  );
  const materials = data.materials.filter(
    (item) =>
      subjects.some((subject) => subject.id === item.subjectId) &&
      (!subjectId || item.subjectId === subjectId),
  );
  const deleting = materials.find((item) => item.id === deletingId);

  return (
    <section className="card card-pad mt">
      <div className="section-head">
        <div>
          <h2>Учебные материалы</h2>
          <p className="muted">Конспекты, инструкции и файлы по вашим предметам.</p>
        </div>
        <button
          type="button"
          className="button small"
          disabled={!subjects.length}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" className="sm" />
          Добавить материал
        </button>
      </div>
      {subjects.length > 1 && (
        <Field label="Предмет материалов">
          <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">Все мои предметы</option>
            {subjects.map((subject) => (
              <option value={subject.id} key={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {materials.length ? (
        <div className="stack">
          {materials.map((material) => (
            <article className="notice" key={material.id}>
              <div className="flex between">
                <div className="grow">
                  <h3>{material.title}</h3>
                  <p className="muted">
                    {data.subjects.find((subject) => subject.id === material.subjectId)?.name}
                  </p>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="button small"
                    onClick={() =>
                      void downloadFile(material.fileId, material.title).catch((cause) =>
                        notify(messageOf(cause)),
                      )
                    }
                  >
                    <Icon name="download" className="sm" />
                    Скачать
                  </button>
                  <button
                    type="button"
                    className="button small"
                    aria-label={`Удалить материал: ${material.title}`}
                    onClick={() => setDeletingId(material.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Материалов пока нет"
          description={
            subjects.length
              ? 'Добавьте файл, чтобы студенты могли использовать его в учёбе.'
              : 'Администратор ещё не назначил вам предметы.'
          }
        />
      )}
      {creating && <MaterialForm onClose={() => setCreating(false)} />}
      {deleting && (
        <DeletePublication
          kind="materials"
          id={deleting.id}
          title={deleting.title}
          onClose={() => setDeletingId(null)}
        />
      )}
    </section>
  );
}
