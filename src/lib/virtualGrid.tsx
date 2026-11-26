import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

/** Same geometry as the shelf grid: `repeat(auto-fill, minmax(236px, 1fr))`. */
export const GRID_MIN_COLUMN = 236;
export const GRID_GAP = 16;

/**
 * The nearest ancestor that actually scrolls. `scrollRef` is attached to
 * `<main>` in App, but refs are committed child-first, so the grid's first
 * layout pass can run before that ref exists. Walking up finds the same
 * element without waiting for a frame.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

interface UseVirtualGridOptions {
  /** Number of shelf entries (cards, loras or family decks). */
  count: number;
  /** The element that actually scrolls — `<main>` in App. */
  scrollRef: RefObject<HTMLElement | null>;
  /**
   * Height of everything below the 4:3 cover (prompt, chips, footer and the
   * tile border). Used only until a row has been measured; keeping it close to
   * the real value means the scrollbar barely moves while the shelf settles.
   */
  textBlockHeight: number;
  minColumnWidth?: number;
  gap?: number;
  /** Rows rendered above and below the viewport. */
  overscanRows?: number;
  /** Bump when content above the grid (import jobs) changes height. */
  revision?: number;
}

interface RowSlice {
  index: number;
  top: number;
}

interface Range {
  start: number;
  end: number;
}

interface VirtualGrid {
  containerRef: RefObject<HTMLDivElement>;
  columns: number;
  rowCount: number;
  totalHeight: number;
  rows: RowSlice[];
  measureRow: (index: number, height: number) => void;
  ready: boolean;
}

/**
 * Row-level windowing for the shelf grids.
 *
 * The grid is laid out as absolute rows instead of one CSS grid: only the rows
 * around the viewport exist in the DOM, while the container keeps the full
 * scroll height. Row heights are measured (tags can wrap differently), cached,
 * and rows above the viewport are compensated for so the shelf never jumps.
 *
 * Cards themselves are never split or clamped: a row is just a CSS grid of the
 * same `1fr` columns the shelf used before, so the visual rhythm is unchanged.
 */
export function useVirtualGrid({
  count,
  scrollRef,
  textBlockHeight,
  minColumnWidth = GRID_MIN_COLUMN,
  gap = GRID_GAP,
  overscanRows = 2,
  revision = 0,
}: UseVirtualGridOptions): VirtualGrid {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, viewport: 0 });
  const [version, setVersion] = useState(0);
  const [range, setRange] = useState<Range | null>(null);
  const heightsRef = useRef<number[]>([]);
  const offsetsRef = useRef<number[]>([]);
  const layoutKeyRef = useRef("");

  const columns = Math.max(
    1,
    Math.floor((size.width + gap) / (minColumnWidth + gap)),
  );
  const rowCount = Math.ceil(count / columns);
  const tileWidth =
    size.width > 0
      ? (size.width - (columns - 1) * gap) / columns
      : minColumnWidth;
  // The cover is 4:3 inside the tile's 10px padding.
  const estimate = Math.max(1, (tileWidth - 20) * 0.75 + textBlockHeight);

  // The container is the measuring stick; the scroller gives the viewport.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const scroller = scrollRef.current ?? findScrollParent(el);
    if (!el || !scroller) return;
    const measure = () => {
      const width = el.clientWidth;
      const viewport = scroller.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.viewport === viewport
          ? prev
          : { width, viewport },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef]);

  // A new column count (or a width change) invalidates every cached row height.
  // `rowCount` is deliberately not part of the key: appending an import must not
  // throw away the heights of rows that are already measured.
  const layoutKey = `${columns}|${Math.round(tileWidth)}`;
  useLayoutEffect(() => {
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    heightsRef.current = new Array(rowCount).fill(estimate);
    setVersion((v) => v + 1);
  }, [layoutKey, rowCount, estimate]);

  // Absolute rows: offsets are the only source of truth for scroll height.
  const { offsets, totalHeight } = useMemo(() => {
    const heights = heightsRef.current;
    const next = new Array<number>(rowCount);
    let y = 0;
    for (let i = 0; i < rowCount; i += 1) {
      next[i] = y;
      y += (heights[i] ?? estimate) + gap;
    }
    return { offsets: next, totalHeight: Math.max(0, y - gap) };
  }, [rowCount, estimate, gap, version]);
  offsetsRef.current = offsets;

  const measureRow = useCallback(
    (index: number, height: number) => {
      if (height <= 0) return;
      const heights = heightsRef.current;
      const prev = heights[index] ?? estimate;
      if (Math.abs(prev - height) < 0.5) {
        if (heights[index] === undefined) heights[index] = height;
        return;
      }
      heights[index] = height;

      // If a row above the viewport changed height, move the scroll offset by
      // the same delta so the content under the cursor stays put.
      const el = containerRef.current;
      const scroller = scrollRef.current ?? findScrollParent(el);
      if (el && scroller && Math.abs(height - prev) > 0.5) {
        const containerTop =
          el.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        const rowTop = containerTop + (offsetsRef.current[index] ?? 0);
        if (rowTop < scroller.scrollTop) {
          scroller.scrollTop += height - prev;
        }
      }
      setVersion((v) => v + 1);
    },
    [estimate, scrollRef],
  );

  const computeRange = useCallback((): Range => {
    const el = containerRef.current;
    const scroller = scrollRef.current ?? findScrollParent(el);
    if (!el || !scroller || rowCount === 0) return { start: 0, end: 0 };

    const containerRect = el.getBoundingClientRect();
    const viewRect = scroller.getBoundingClientRect();
    const top = containerRect.top - viewRect.top;
    const overscan = overscanRows * (estimate + gap);
    const minY = -top - overscan;
    const maxY = viewRect.height - top + overscan;
    const heights = heightsRef.current;

    // First row whose bottom is below the top edge of the window.
    let lo = 0;
    let hi = rowCount - 1;
    let start = rowCount;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const bottom = offsets[mid] + (heights[mid] ?? estimate);
      if (bottom > minY) {
        start = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (start >= rowCount) return { start: rowCount, end: rowCount };

    // Last row whose top is above the bottom edge of the window.
    lo = start;
    hi = rowCount - 1;
    let end = rowCount;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < maxY) {
        lo = mid + 1;
      } else {
        end = mid;
        hi = mid - 1;
      }
    }
    return { start, end: Math.max(start, end) };
  }, [estimate, gap, offsets, overscanRows, rowCount, scrollRef, revision]);

  // Recompute before paint whenever the grid shape or a measurement changes.
  useLayoutEffect(() => {
    // A filter can leave the shelf shorter than the current offset. Clamp
    // first, so the range below is computed against the position the browser
    // will actually paint instead of a stale offset.
    const scroller =
      scrollRef.current ?? findScrollParent(containerRef.current);
    if (scroller) {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop > max) scroller.scrollTop = max;
    }
    const next = computeRange();
    setRange((prev) =>
      prev && prev.start === next.start && prev.end === next.end
        ? prev
        : next,
    );
  }, [computeRange, scrollRef]);

  // One layout read per animation frame, no matter how fast the wheel spins.
  useEffect(() => {
    const scroller =
      scrollRef.current ?? findScrollParent(containerRef.current);
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = computeRange();
        setRange((prev) =>
          prev && prev.start === next.start && prev.end === next.end
            ? prev
            : next,
        );
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [computeRange, scrollRef]);

  // Until the first measurement lands, render the top of the shelf so there is
  // no blank frame between mount and the first layout pass.
  const effectiveRange =
    range ?? { start: 0, end: Math.min(rowCount, 4) };

  const rows = useMemo(() => {
    const out: RowSlice[] = [];
    const last = Math.min(effectiveRange.end, rowCount);
    for (let i = effectiveRange.start; i < last; i += 1) {
      out.push({ index: i, top: offsets[i] ?? 0 });
    }
    return out;
  }, [effectiveRange.start, effectiveRange.end, offsets, rowCount]);

  return {
    containerRef,
    columns,
    rowCount,
    totalHeight,
    rows,
    measureRow,
    ready: size.width > 0 && size.viewport > 0,
  };
}

/**
 * True only for the first beat after a shelf mounts. The entrance stagger is a
 * mount-time affair; virtual rows remount on every scroll, and replaying it
 * there would make fast scrolling feel like a slideshow.
 */
export function useEntranceWindow(ms = 900): boolean {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setEntering(false), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return entering;
}

interface VirtualRowProps {
  index: number;
  top: number;
  columns: number;
  gap: number;
  /** Fade rows that mount while scrolling; the first screen uses tile stagger. */
  animate: boolean;
  onMeasure: (index: number, height: number) => void;
  children: ReactNode;
}

/** One absolute shelf row. Its content-driven height feeds the offset cache. */
export function VirtualRow({
  index,
  top,
  columns,
  gap,
  animate,
  onMeasure,
  children,
}: VirtualRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Captured at mount: `entering` flips once the first beat is over, and a
  // class that appears after mount would restart the fade on rows already on
  // screen.
  const [anim] = useState(animate);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `offsetHeight` is the untransformed layout height; `getBoundingClientRect`
    // would pick up any scale on an animating ancestor.
    const report = () => onMeasure(index, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [index, onMeasure]);

  return (
    <div
      ref={ref}
      className={anim ? "anim-row" : undefined}
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        columnGap: gap,
      }}
    >
      {children}
    </div>
  );
}
