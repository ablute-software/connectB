// Prompt 930 (B) — a host for the REAL SubmissionsTab (the Applications screen), bundled into a real browser by submissions-tab.browser.test.ts; the test answers its /api/calls/… requests. Test-only.
import { createRoot } from 'react-dom/client';
import { SubmissionsTab } from './SubmissionsTab';

declare global { interface Window { __startSubmissions: () => void } }

window.__startSubmissions = () => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}><SubmissionsTab callId="c1" timezone="Europe/Lisbon" currency="EUR" /></div>,
  );
};
