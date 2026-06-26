// Row virtualizer for the grid (M5).
//
// Why hand-rolled instead of react-window/react-virtual: those position items
// with `position:absolute` + transform, which fights this grid's sticky header
// and sticky Key/source columns. Here every `.row` is its own CSS Grid with
// FIXED column widths (see gridStyles header), so rows don't depend on a shared
// parent grid. That lets us keep off-screen rows out of the DOM and reserve
// their space with two spacer blocks (padTop/padBottom) — sticky and column
// alignment keep working untouched.
//
// Heights are dynamic: key comments, multi-line values, warnings, and the
// editing textarea (which auto-grows) all change a row's height. A
// ResizeObserver measures each rendered row and caches it by a stable key, so
// the scrollbar and window stay accurate as you scroll and edit.

import { useCallback, useEffect, useRef, useState } from "react";

/** How far above/below the viewport to keep rows mounted (smooth scrolling). */
const OVERSCAN_PX = 600;
/** Used before the container has been measured. */
const DEFAULT_VIEWPORT = 800;

export interface RowVirtualizer {
  /** Attach to the scroll container (`.grid-wrap`). */
  scrollRef: (el: HTMLElement | null) => void;
  /** Attach to the rows' flow parent (`.grid-body`) — anchors the offsets. */
  bodyRef: (el: HTMLElement | null) => void;
  /** Callback ref factory: attach `itemRef(key)` to each rendered row. */
  itemRef: (key: string) => (el: HTMLElement | null) => void;
  /** First visible index (inclusive). */
  start: number;
  /** Last visible index (exclusive). */
  end: number;
  /** Pixels of empty space to reserve above the window. */
  padTop: number;
  /** Pixels of empty space to reserve below the window. */
  padBottom: number;
  /** Attach to the sticky header row (`.row.head`) — its height is the band the
   * top of the viewport is hidden behind, so `ensureVisible` clears it. */
  headRef: (el: HTMLElement | null) => void;
  /** Scroll row `index` just into view (no-op if already fully visible), keeping
   * it below the sticky header. Used by keyboard navigation. */
  ensureVisible: (index: number) => void;
}

/**
 * Virtualize a flat list of rows keyed by `keys`. `estimate` is the assumed
 * height of an unmeasured row; `resetSignal` clears the height cache when it
 * changes (e.g. the visible columns changed, so heights are stale).
 */
export function useRowVirtualizer(
  keys: string[],
  estimate: number,
  resetSignal: string
): RowVirtualizer {
  const heights = useRef<Map<string, number>>(new Map());
  const lastReset = useRef(resetSignal);
  if (lastReset.current !== resetSignal) {
    heights.current.clear();
    lastReset.current = resetSignal;
  }

  const scrollEl = useRef<HTMLElement | null>(null);
  const bodyEl = useRef<HTMLElement | null>(null);
  const headEl = useRef<HTMLElement | null>(null);
  // Cumulative row offsets from the last render, so ensureVisible can locate a
  // row by index without recomputing.
  const offsetsRef = useRef<number[]>([]);

  // Body-relative scroll offset (how far the body has scrolled up past the
  // container's top edge) and the visible height. Refs, read at render time.
  const top = useRef(0);
  const viewport = useRef(DEFAULT_VIEWPORT);

  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);

  const measure = useCallback(() => {
    const s = scrollEl.current;
    const b = bodyEl.current;
    if (!s || !b) return;
    const sr = s.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    // sr.top - br.top accounts for the sticky header reserving space above the
    // body, so offsets stay relative to the first row.
    top.current = sr.top - br.top;
    viewport.current = s.clientHeight || DEFAULT_VIEWPORT;
  }, []);

  const onScroll = useCallback(() => {
    measure();
    rerender();
  }, [measure, rerender]);

  // ResizeObserver tracks each rendered row's height (initial + edits/wraps).
  const roRef = useRef<ResizeObserver | null>(null);
  const getRO = useCallback(() => {
    if (!roRef.current && typeof ResizeObserver !== "undefined") {
      roRef.current = new ResizeObserver((entries) => {
        let changed = false;
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const k = el.dataset.vkey;
          if (!k) continue;
          const h = el.offsetHeight;
          if (h > 0 && heights.current.get(k) !== h) {
            heights.current.set(k, h);
            changed = true;
          }
        }
        if (changed) rerender();
      });
    }
    return roRef.current;
  }, [rerender]);

  const observed = useRef<Map<string, HTMLElement>>(new Map());

  const itemRef = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      const ro = getRO();
      const prev = observed.current.get(key);
      if (prev && prev !== el) {
        ro?.unobserve(prev);
        observed.current.delete(key);
      }
      if (el) {
        el.dataset.vkey = key;
        observed.current.set(key, el);
        ro?.observe(el);
        // Sync read for a correct first layout (RO's first callback is async).
        const h = el.offsetHeight;
        if (h > 0 && heights.current.get(key) !== h) {
          heights.current.set(key, h);
        }
      }
    },
    [getRO]
  );

  const scrollRef = useCallback(
    (el: HTMLElement | null) => {
      if (scrollEl.current) {
        scrollEl.current.removeEventListener("scroll", onScroll);
      }
      scrollEl.current = el;
      if (el) {
        el.addEventListener("scroll", onScroll, { passive: true });
        measure();
      }
    },
    [onScroll, measure]
  );

  const bodyRef = useCallback(
    (el: HTMLElement | null) => {
      bodyEl.current = el;
      measure();
    },
    [measure]
  );

  const headRef = useCallback((el: HTMLElement | null) => {
    headEl.current = el;
  }, []);

  // Scroll just enough to reveal row `index` below the sticky header. Works even
  // for an off-screen (unmounted) row: offsets use the estimate for unmeasured
  // rows, so the scroll lands close; the row then mounts and a re-measure
  // corrects any drift. measure()+rerender() apply the new window synchronously.
  const ensureVisible = useCallback(
    (index: number) => {
      const s = scrollEl.current;
      const b = bodyEl.current;
      const offs = offsetsRef.current;
      if (!s || !b || index < 0 || index + 1 >= offs.length) return;
      const sr = s.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const headH = headEl.current
        ? headEl.current.getBoundingClientRect().height
        : 0;
      const rowTop = br.top + offs[index];
      const rowBottom = br.top + offs[index + 1];
      const usableTop = sr.top + headH;
      const usableBottom = sr.bottom;
      const margin = 6;
      let delta = 0;
      if (rowTop < usableTop) delta = rowTop - usableTop - margin;
      else if (rowBottom > usableBottom) delta = rowBottom - usableBottom + margin;
      if (delta !== 0) {
        s.scrollTop += delta;
        measure();
        rerender();
      }
    },
    [measure, rerender]
  );

  // Re-measure when the container itself resizes (window/pane resize).
  useEffect(() => {
    const s = scrollEl.current;
    if (!s || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      measure();
      rerender();
    });
    ro.observe(s);
    return () => ro.disconnect();
  }, [measure, rerender]);

  // First measurement after mount, then teardown on unmount.
  useEffect(() => {
    measure();
    rerender();
    return () => {
      roRef.current?.disconnect();
      if (scrollEl.current) {
        scrollEl.current.removeEventListener("scroll", onScroll);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Compute the visible window from cached/estimated heights ----
  const n = keys.length;
  const offsets = new Array<number>(n + 1);
  offsets[0] = 0;
  for (let i = 0; i < n; i++) {
    offsets[i + 1] = offsets[i] + (heights.current.get(keys[i]) ?? estimate);
  }
  const total = offsets[n];
  offsetsRef.current = offsets;
  const lo = top.current - OVERSCAN_PX;
  const hi = top.current + viewport.current + OVERSCAN_PX;

  let start = 0;
  while (start < n && offsets[start + 1] <= lo) start++;
  let end = start;
  while (end < n && offsets[end] < hi) end++;

  return {
    scrollRef,
    bodyRef,
    itemRef,
    headRef,
    ensureVisible,
    start,
    end,
    padTop: offsets[start],
    padBottom: total - offsets[end],
  };
}
