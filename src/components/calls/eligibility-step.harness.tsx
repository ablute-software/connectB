// Prompt 918 (I2) — a tiny host for the REAL EligibilityStep, bundled into a real browser by eligibility-step.browser.test.ts (the test answers its /api/calls/… requests). Test-only.
import { createRoot } from 'react-dom/client';
import { EligibilityStep } from './EligibilityStep';

declare global { interface Window { __startEligibility: (opts?: { canManage?: boolean }) => void; __count: number } }

window.__startEligibility = (opts) => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}>
      <EligibilityStep callId="c1" call={{ currency: 'EUR', opensAt: '2026-10-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', timezone: 'Europe/Lisbon' }}
        disabled={false} canManage={opts?.canManage ?? true} onRulesChanged={(n) => { window.__count = n; }} onState={() => {}} />
    </div>,
  );
};
