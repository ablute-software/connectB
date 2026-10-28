// Prompt 922 (I1) — a tiny host for the REAL EvalGridStep, bundled into a real browser by eval-grid-step.browser.test.ts (the test answers its /api/calls/… requests). Test-only.
import { createRoot } from 'react-dom/client';
import { EvalGridStep } from './EvalGridStep';

declare global { interface Window { __startGrid: (opts?: { canManage?: boolean }) => void; __count: number } }

window.__startGrid = (opts) => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}>
      <EvalGridStep callId="c1" canManage={opts?.canManage ?? true} onCriteriaChanged={(n) => { window.__count = n; }} />
    </div>,
  );
};
