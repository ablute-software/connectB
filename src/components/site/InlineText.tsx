// Prompt 920 — renders the one bit of markup the site's copy uses: [label](href). Everything else is plain text (React escapes it).
// The same strings go to the JSON-LD with the markup removed (site-schema.ts plainAnswer), so a reader and a machine get the same words.
import Link from 'next/link';
import type { ReactNode } from 'react';

export function InlineText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Link key={key++} href={m[2]}>{m[1]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
