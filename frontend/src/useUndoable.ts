import { useCallback, useRef, useState } from "react";

interface History<T> { present: T; past: T[]; future: T[]; version: number }

/**
 * State with undo/redo. Edits made within COALESCE_MS of each other (typing) form one undo step.
 * `version` changes on undo/redo/reset so components holding local text state can re-mount.
 */
const COALESCE_MS = 700;
const LIMIT = 100;

export function useUndoable<T>(initial: T) {
  const [h, setH] = useState<History<T>>({ present: initial, past: [], future: [], version: 0 });
  const lastChange = useRef(0);

  const set = useCallback((v: T | ((cur: T) => T)) => {
    const now = Date.now();
    const coalesce = now - lastChange.current < COALESCE_MS;
    lastChange.current = now;
    setH((s) => {
      const next = typeof v === "function" ? (v as (c: T) => T)(s.present) : v;
      if (Object.is(next, s.present)) return s;
      const past = coalesce && s.past.length ? s.past : [...s.past, s.present].slice(-LIMIT);
      return { ...s, present: next, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastChange.current = 0;
    setH((s) => (s.past.length
      ? { present: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.present, ...s.future], version: s.version + 1 }
      : s));
  }, []);

  const redo = useCallback(() => {
    lastChange.current = 0;
    setH((s) => (s.future.length
      ? { present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1), version: s.version + 1 }
      : s));
  }, []);

  /** Replace the state without creating an undo step (loading a project, first load). */
  const reset = useCallback((v: T) => {
    lastChange.current = 0;
    setH((s) => ({ present: v, past: [], future: [], version: s.version + 1 }));
  }, []);

  return { state: h.present, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0, version: h.version };
}
