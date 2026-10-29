// Prompt 922 (Adenda 1, A) — a host for the REAL CallEditor, bundled into a real browser by call-editor-grid.browser.test.ts: the grid step is reached through the real editor (its state, its callbacks, its re-renders), which is
// where "Add a criterion" used to open and vanish. The server is the test's (page.route). Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import { CallEditor } from './CallEditor';

window.addEventListener('DOMContentLoaded', () => undefined);
(window as unknown as { __startEditor: () => void }).__startEditor = () => {
  createRoot(document.getElementById('root')!).render(<CallEditor callId="call-1" onBack={() => {}} />);
};
