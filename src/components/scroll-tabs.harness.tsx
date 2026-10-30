// Prompt 924 (acerto) — a host for the REAL ScrollTabs, bundled into a real browser by scroll-tabs.browser.test.ts. Test-only: nothing in the app imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScrollTabs } from './ScrollTabs';

declare global { interface Window { __startTabs: (o: { count: number }) => void } }

function Bar({ count }: { count: number }) {
  const [on, setOn] = useState(0);
  return (
    <div style={{ padding: 16 }}>
      <ScrollTabs label="Sections" testId="bar" className="mb-5 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200">
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" role="tab" aria-selected={on === i} data-testid={`tab-${i}`} onClick={() => setOn(i)} className="-mb-px min-h-[44px] shrink-0 border-b-2 px-4 py-2 text-sm">{`Section number ${i + 1}`}</button>
        ))}
      </ScrollTabs>
      <button type="button" data-testid="select-last" onClick={() => setOn(count - 1)}>last</button>
    </div>
  );
}

window.__startTabs = ({ count }) => { createRoot(document.getElementById('root')!).render(<Bar count={count} />); };
