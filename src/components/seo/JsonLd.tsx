// Prompt 920 — invisible structured data for a public page. A server component: it renders one <script type="application/ld+json"> and
// nothing a visitor can see. The data is built by src/lib/site-schema.ts from the same lists the page draws.
import { serializeJsonLd } from '@/lib/site-schema';

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
