// Prompt 918 (I3) — a tiny host for the REAL ApplicationEligibility, bundled into a real browser by application-eligibility.browser.test.ts (the test answers its request). Test-only.
import { createRoot } from 'react-dom/client';
import type { EligibilityInfo } from '@/lib/calls/eligibility-payload';
import { ApplicationEligibility } from './ApplicationEligibility';

declare global { interface Window { __startPanel: (opts: { info: EligibilityInfo; canCorrect: boolean; canFlag: boolean }) => void; __changed: number } }

window.__startPanel = ({ info, canCorrect, canFlag }) => {
  window.__changed = 0;
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}><ApplicationEligibility callId="c1" applicationId="a1" info={info} canCorrect={canCorrect} canFlag={canFlag} onChanged={() => { window.__changed += 1; }} /></div>,
  );
};
