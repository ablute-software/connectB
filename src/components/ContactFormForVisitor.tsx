'use client';
// The one piece of /contact that needs the browser: `?from=investors` (set by the /investors footer link) is the only thing that decides
// which `source` the ticket records; nothing else about the form changes between the two. Split out of the page (Prompt 920 addendum) so the
// page itself can be a server component — with its own <title>, description and heading in the HTML — and only this subtree waits for the
// query string.
import { useSearchParams } from 'next/navigation';
import { ContactForm } from '@/components/ContactForm';

export function ContactFormForVisitor() {
  const sp = useSearchParams();
  const source = sp.get('from') === 'investors' ? 'landing_investors' : 'landing';
  return <ContactForm source={source} />;
}
