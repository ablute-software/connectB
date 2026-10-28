// Prompt 922 (I2) — a tiny host for the REAL DistributionPanel, bundled into a real browser by distribution-panel.browser.test.ts (the test answers its /api/calls/… requests). Test-only.
import { createRoot } from 'react-dom/client';
import { DistributionPanel } from './DistributionPanel';

declare global { interface Window { __startDistribution: (opts?: { canManage?: boolean }) => void } }

window.__startDistribution = (opts) => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}><DistributionPanel callId="c1" canManage={opts?.canManage ?? true} /></div>,
  );
};
