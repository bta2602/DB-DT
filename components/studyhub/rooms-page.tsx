'use client';

import { useState, type FormEvent } from 'react';
import type { Room, RoomType } from '@/lib/studyhub/api-contract';
import { formatTime, lessonStatus } from '@/lib/studyhub/client-utils';
import { campusLabels } from '@/lib/studyhub/campus-labels';
import {
  emptyRoomFilters,
  isRoomFilters,
  matchesRoom,
  normalizeRoomFilters,
  roomTypes,
} from '@/lib/studyhub/campus-filters';
import { useStudyHub } from './context';
import { useI18n } from './preferences';
import { Badge, EmptyState, Field, Icon, Modal, PageHeading } from './shared';
import { useBrowserStorage } from './use-browser-storage';
import { StorageFeedback } from './storage-feedback';
import './campus-settings.css';

const roomNumberPattern = '[0-9]{1,5}[А-ЯA-Z]?';

function RoomEditor({ room, onClose }: { room?: Room; onClose: () => void }) {
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const { mutate, notify } = useStudyHub();
  const [number, setNumber] = useState(room?.number || '');
  const [type, setType] = useState<RoomType | ''>(room?.type || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !type) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await mutate(room ? 'PATCH' : 'POST', room ? `/api/rooms/${room.id}` : '/api/rooms', {
        name: `${number.trim()} · ${campusLabels.ru.roomsType[type]}`,
        number: number.trim(),
        type,
        floor: Number(fields.get('floor')),
        capacity: Number(fields.get('capacity')),
        ...(room ? { version: room.version } : {}),
      });
      notify(labels.saved);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={room ? labels.editRoom : labels.addRoom} onClose={onClose} closeDisabled={busy}>
      <form onSubmit={save}>
        <fieldset disabled={busy} className="campus-panel">
          <div className="campus-grid">
            <Field label={labels.number}>
              <input
                value={number}
                onChange={(event) => setNumber(event.target.value.toUpperCase())}
                required
                maxLength={6}
                pattern={roomNumberPattern}
              />
            </Field>
            <Field label={labels.floor}>
              <input
                name="floor"
                type="number"
                min={1}
                max={100}
                step={1}
                required
                defaultValue={room?.floor ?? ''}
              />
            </Field>
            <Field label={labels.type}>
              <select
                required
                value={type}
                onChange={(event) => setType(event.target.value as RoomType)}
              >
                <option value="">{labels.select}</option>
                {roomTypes.map((value) => (
                  <option key={value} value={value}>
                    {labels.roomsType[value]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={labels.capacity}>
              <input
                name="capacity"
                type="number"
                min={1}
                max={1000}
                step={1}
                required
                defaultValue={room?.capacity ?? ''}
              />
            </Field>
          </div>
          <p className="campus-notice">{labels.roomHint}</p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="button" onClick={onClose}>
              {labels.cancel}
            </button>
            <button className="button primary" type="submit">
              {busy ? labels.saving : labels.save}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export function RoomsPage() {
  const { locale } = useI18n();
  const labels = campusLabels[locale];
  const { data, user, now, ready, error } = useStudyHub();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const storage = useBrowserStorage({
    userId: user?.id,
    area: 'room-filters',
    fallback: emptyRoomFilters,
    validate: isRoomFilters,
  });
  const availabilityKnown = user?.role === 'admin' && ready && !error;
  const filters = normalizeRoomFilters(storage.value, data.rooms, availabilityKnown);
  const occupied = new Map(
    data.lessons
      .filter((lesson) => lesson.roomId && lessonStatus(lesson, now) === 'current')
      .map((lesson) => [lesson.roomId, lesson]),
  );
  const floors = [
    ...new Set(data.rooms.flatMap((room) => (room.floor == null ? [] : [room.floor]))),
  ].sort((a, b) => a - b);
  const rooms = data.rooms.filter((room) => matchesRoom(room, filters, occupied.has(room.id)));
  const change = (key: keyof typeof filters, value: string) =>
    storage.setValue({ ...filters, [key]: value });
  return (
    <>
      <PageHeading
        title={labels.rooms}
        description={labels.roomsIntro}
        action={
          user?.role === 'admin' && (
            <button type="button" className="button primary" onClick={() => setEditing('new')}>
              <Icon name="plus" className="sm" />
              {labels.addRoom}
            </button>
          )
        }
      />
      <div className="campus-panel">
        <div className="campus-toolbar">
          <Field label={labels.search}>
            <input
              type="search"
              value={filters.query}
              maxLength={100}
              disabled={!storage.ready}
              onChange={(event) => change('query', event.target.value)}
            />
          </Field>
          <Field label={labels.floor}>
            <select
              value={filters.floor}
              disabled={!storage.ready}
              onChange={(event) => change('floor', event.target.value)}
            >
              <option value="">{labels.all}</option>
              {floors.map((floor) => (
                <option key={floor} value={floor}>
                  {floor}
                </option>
              ))}
            </select>
          </Field>
          <Field label={labels.type}>
            <select
              value={filters.type}
              disabled={!storage.ready}
              onChange={(event) => change('type', event.target.value)}
            >
              <option value="">{labels.all}</option>
              {roomTypes.map((type) => (
                <option key={type} value={type}>
                  {labels.roomsType[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={labels.occupancy}>
            <select
              value={filters.occupancy}
              disabled={!storage.ready || !availabilityKnown}
              onChange={(event) => change('occupancy', event.target.value)}
            >
              <option value="">{labels.all}</option>
              <option value="free">{labels.free}</option>
              <option value="busy">{labels.busy}</option>
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <button
            className="button"
            type="button"
            disabled={!storage.ready}
            onClick={storage.reset}
          >
            {labels.reset}
          </button>
        </div>
        <StorageFeedback status={storage.status} />
        {!availabilityKnown && <p className="campus-notice">{labels.unknownOccupancy}</p>}
      </div>
      <p className="muted" role="status">
        {labels.found}: {rooms.length} {labels.total} {data.rooms.length}
      </p>
      {rooms.length ? (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  labels.rooms,
                  labels.floor,
                  labels.type,
                  labels.capacity,
                  labels.now,
                  ...(user?.role === 'admin' ? [labels.action] : []),
                ].map((title) => (
                  <th key={title} scope="col">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const lesson = occupied.get(room.id);
                return (
                  <tr key={room.id}>
                    <td>
                      <strong>{room.number || room.name}</strong>
                    </td>
                    <td>{room.floor ?? '—'}</td>
                    <td>{room.type ? labels.roomsType[room.type] : labels.unknown}</td>
                    <td>{room.capacity ?? '—'}</td>
                    <td>
                      {!availabilityKnown ? (
                        labels.unknown
                      ) : lesson ? (
                        <>
                          <Badge kind="neutral">{labels.busy}</Badge>
                          <br />
                          <span className="muted">
                            {data.groups.find((group) => group.id === lesson.groupId)?.name} ·{' '}
                            {labels.until} {formatTime(lesson.endsAt)}
                          </span>
                        </>
                      ) : (
                        <Badge>{labels.free}</Badge>
                      )}
                    </td>
                    {user?.role === 'admin' && (
                      <td>
                        <button
                          type="button"
                          className="button small"
                          aria-label={`${labels.editRoom}: ${room.number || room.name}`}
                          onClick={() => setEditing(room)}
                        >
                          {labels.edit}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={data.rooms.length ? labels.noResults : labels.noRooms}
          description={labels.changeFilters}
        />
      )}
      {editing && user?.role === 'admin' && (
        <RoomEditor
          key={`${user.id}:${editing === 'new' ? 'new' : editing.id}`}
          room={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
