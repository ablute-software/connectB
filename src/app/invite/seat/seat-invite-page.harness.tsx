// Prompt 923 (B, C) — a tiny host for the REAL seat-invitation page and the REAL investor sign-in form, bundled into a real browser by seat-invite-page.browser.test.ts (which answers their /api/invite/seat/… requests and
// stands in for the auth provider). Test-only.
import { createRoot } from 'react-dom/client';
import SeatInvitePage from './[token]/page';
import { InvestorSignInForm } from '@/components/auth/InvestorSignInForm';

declare global { interface Window { __startPage: (token: string) => void; __startSignIn: () => void } }

window.__startPage = (token) => { createRoot(document.getElementById('root')!).render(<SeatInvitePage params={{ token }} />); };
window.__startSignIn = () => {
  createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 384, margin: '24px auto', padding: 16 }}><InvestorSignInForm next="/go?as=investor" linkFailed={false} /></div>);
};
