// Prompt 920 — one accordion of questions, drawn with the landing's own FAQ styles (the same ones /investors uses). The answer is in the
// HTML from the first byte: <details> only hides it visually — nothing is fetched or rendered on click, so a crawler reads every answer.
import type { FaqItem } from '@/content/site/faq';
import s from '@/app/landing.module.css';
import p from './site-page.module.css';
import { InlineText } from './InlineText';

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className={s.faq}>
      {items.map((item) => (
        <details key={item.id} id={item.id} className={s.faqItem}>
          <summary>{item.q}</summary>
          <p className={p.faqBody}><InlineText text={item.a} /></p>
        </details>
      ))}
    </div>
  );
}
