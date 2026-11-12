'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiMessage } from '@/lib/api';

const SAVE_DELAY_MS = 1000;
const MAX_HISTORY = 50;
const FIELDS = ['name', 'site', 'range', 'segments', 'tabs'];
const pick = (e) => Object.fromEntries(FIELDS.map((k) => [k, e[k]]));

/**
 * Editor state for one saved exploration: load, edit with undo/redo, autosave (owner/admin only).
 * `update(fn)` takes the current exploration and returns the next one.
 */
export function useExploration(id) {
  const [exp, setExp] = useState(null);
  const [meta, setMeta] = useState(null); // { owner, canEdit, updatedAt }
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('saved'); // saved | pending | saving | error | readonly
  const past = useRef([]);
  const future = useRef([]);
  const timer = useRef(null);
  const latest = useRef(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (!id || id === 'new') return undefined;
    let alive = true;
    api(`/explorations/${id}`).then((d) => {
      if (!alive) return;
      setExp(pick(d));
      setMeta({ owner: d.owner, canEdit: d.canEdit, updatedAt: d.updatedAt });
      setStatus(d.canEdit ? 'saved' : 'readonly');
    }).catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [id]);

  const save = useCallback(async () => {
    if (!latest.current) return;
    setStatus('saving');
    try {
      const d = await api(`/explorations/${id}`, { method: 'PATCH', body: latest.current });
      setMeta((m) => ({ ...m, updatedAt: d.updatedAt }));
      setStatus((s) => (s === 'saving' ? 'saved' : s));
    } catch (e) {
      setStatus('error');
      setError(null);
      console.warn('Exploration save failed', apiMessage(e));
    }
  }, [id]);

  const commit = useCallback((next) => {
    setExp(next);
    latest.current = next;
    if (!meta?.canEdit) return;
    setStatus('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [meta?.canEdit, save]);

  const update = useCallback((fn) => {
    setExp((cur) => {
      if (!cur) return cur;
      const next = typeof fn === 'function' ? fn(cur) : { ...cur, ...fn };
      if (next === cur) return cur;
      past.current = [...past.current.slice(-MAX_HISTORY + 1), cur];
      future.current = [];
      queueMicrotask(() => commit(next));
      return next;
    });
  }, [commit]);

  const undo = useCallback(() => {
    if (!past.current.length || !exp) return;
    const prev = past.current.at(-1);
    past.current = past.current.slice(0, -1);
    future.current = [exp, ...future.current];
    commit(prev);
    force((n) => n + 1);
  }, [exp, commit]);
  const redo = useCallback(() => {
    if (!future.current.length || !exp) return;
    const [next, ...rest] = future.current;
    future.current = rest;
    past.current = [...past.current, exp];
    commit(next);
    force((n) => n + 1);
  }, [exp, commit]);

  // Save pending changes when leaving the page.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); if (latest.current && meta?.canEdit) api(`/explorations/${id}`, { method: 'PATCH', body: latest.current }).catch(() => {}); } }, [id, meta?.canEdit]);

  return { exp, meta, error, status, update, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, saveNow: save };
}
