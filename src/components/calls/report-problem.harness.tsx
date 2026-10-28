// Prompt 918 (I3) — a tiny host for the REAL ReportProblem, bundled into a real browser by report-problem.browser.test.ts. Test-only.
import { createRoot } from 'react-dom/client';
import { ReportProblem } from './applicant/ReportProblem';

declare global { interface Window { __startReport: (signedIn: boolean) => void } }

window.__startReport = (signedIn) => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12, maxWidth: 640 }}><p>Applicant page content…</p><ReportProblem token="tok-1" page="form" signedIn={signedIn} /></div>,
  );
};
