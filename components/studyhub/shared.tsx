'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { User } from '@/lib/studyhub/api-contract';
import { initials, roles } from '@/lib/studyhub/client-utils';
import { ICONS } from '@/lib/studyhub/icons';
import { useStudyHub } from './context';

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.book} /></svg>;
}
export function Brand() { return <div className="brand"><span className="brand-mark"><Icon name="book" /></span><span>Study<span>HUB</span></span></div>; }
export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">Учебное пространство · StudyHUB</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function EmptyState({ title, description }: { title: string; description?: string }) { return <div className="empty"><Icon name="book" /><h3>{title}</h3>{description && <p>{description}</p>}</div>; }
export function Badge({ children, kind = '' }: { children: ReactNode; kind?: string }) { return <span className={`pill ${kind}`}>{children}</span>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field">{label}{children}</label>; }
export function Person({ user }: { user?: User | null }) {
  const { data } = useStudyHub();
  return <div className="student-cell"><span className="avatar">{initials(user?.name)}</span><div><strong>{user?.name || 'Пользователь'}</strong><small>{user?.groupId ? data.groups.find(group => group.id === user.groupId)?.name : user ? roles[user.role] : ''}</small></div></div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="studyhub-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => {
    const rect = event.currentTarget.getBoundingClientRect();
    backdropPressed.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }} onClick={event => {
    const startedOutside = backdropPressed.current;
    backdropPressed.current = false;
    if (!startedOutside || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><header className="publication-dialog-head"><h2 id={headingId}>{title}</h2><button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}><Icon name="close" /></button></header><div className="publication-dialog-body">{children}</div></dialog>;
}
