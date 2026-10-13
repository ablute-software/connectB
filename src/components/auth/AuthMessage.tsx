'use client';
// Prompt 911 (follow-up) — an authentication message, with "contact us" as a real link to the contact form (/contact).
// The platform has no public support ADDRESS (docs/ops/CONFIG_REGISTRY.md, "Contacto de suporte"), so messages never print an email:
// they send people to the form. Everything else in the message is plain text.
import { CONTACT_PATH, CONTACT_PHRASE } from '@/lib/auth-errors';

export function AuthMessage({ text }: { text: string }) {
  const at = text.indexOf(CONTACT_PHRASE);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={CONTACT_PATH} className="font-medium underline" data-testid="contact-link">{CONTACT_PHRASE}</a>
      {text.slice(at + CONTACT_PHRASE.length)}
    </>
  );
}
