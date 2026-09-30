// Prompt I-01c §B — the workspace moved to /ecosystem; old links (e-mails
// already sent, bookmarks) keep working.
import { redirect } from 'next/navigation';

export default function IncubatorRedirectPage() {
  redirect('/ecosystem');
}
