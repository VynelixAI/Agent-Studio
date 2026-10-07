import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Axis = "x" | "y";

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* ignore quota */
  }
}

export function usePanelSize(opts: {
  storageKey: string;
  defaultSize: number;
  min: number;
  max: number;
  /** x = width (drag right increases), y = height (drag down increases) */
  axis: Axis;
  /** Flip direction: left panel edge dragged left shrinks when inverted */
  invert?: boolean;
}) {
  const { storageKey, defaultSize, min, max, axis, invert = false } = opts;
  const [size, setSize] = useState(() =>
    clamp(readStored(storageKey, defaultSize), min, max),
  );
  const drag = useRef<{ start: number; origin: number } | null>(null);

  useEffect(() => {
    setSize((s) => clamp(s, min, max));
  }, [min, max]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = {
        start: axis === "x" ? e.clientX : e.clientY,
        origin: size,
      };
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, size],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!drag.current) return;
      const pos = axis === "x" ? e.clientX : e.clientY;
      const delta = pos - drag.current.start;
      const next = clamp(
        drag.current.origin + (invert ? -delta : delta),
        min,
        max,
      );
      setSize(next);
    },
    [axis, invert, min, max],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      if (!drag.current) return;
      drag.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSize((s) => {
        writeStored(storageKey, s);
        return s;
      });
    },
    [storageKey],
  );

  const setSizeClamped = useCallback(
    (next: number | ((prev: number) => number)) => {
      setSize((prev) => {
        const v = typeof next === "function" ? next(prev) : next;
        const c = clamp(v, min, max);
        writeStored(storageKey, c);
        return c;
      });
    },
    [min, max, storageKey],
  );

  return {
    size,
    setSize: setSizeClamped,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
