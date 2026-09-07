'use client';
// Prompt 611 §D — the horizontal scrollbar moves from under the table to
// above it, so "there are columns you cannot see" is visible before you go
// looking for it. A table twenty columns wide with its only scrollbar a
// screen and a half below the header hides its own width.
//
// One table in the DOM, never two (§D says so explicitly, and a duplicated
// table would double every id, every control and every accessibility tree
// entry). The top bar is an empty element whose only job is to be scrollable:
// a container with `overflow-x:auto` holding a spacer as wide as the real
// table. The two scrollLeft values are mirrored in both directions.
//
// The feedback loop is avoided WITHOUT a timer or an "isSyncing" flag: the
// mirror only writes when the value actually differs, and assigning the value
// an element already has does not fire a scroll event. A flag would have to
// be cleared on some future tick, and every version of that has a window in
// which a real user scroll is swallowed.
import { useCallback, useEffect, useRef, useState } from 'react';

export function HorizontalScroller({ children }: { children: React.ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    setContentWidth(body.scrollWidth);
    setOverflowing(body.scrollWidth > body.clientWidth + 1);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    measure();
    // The table's width changes with the data (a page-size change, a filter,
    // a longer name), not only with the window — so observe the element, not
    // the viewport.
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    return () => ro.disconnect();
  }, [measure, children]);

  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
  };

  return (
    <div>
      {/* Hidden entirely when everything fits: a scrollbar for content that
          does not overflow is a control that lies. */}
      {overflowing && (
        <div ref={barRef} onScroll={() => mirror(barRef.current, bodyRef.current)}
          aria-hidden="true"
          className="bo-hscroll-bar mb-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
      <div ref={bodyRef} onScroll={() => mirror(bodyRef.current, barRef.current)}
        className={`overflow-x-auto ${overflowing ? 'bo-hscroll-body' : ''}`}>
        {children}
      </div>
    </div>
  );
}
