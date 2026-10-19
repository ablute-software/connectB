// Prompt 918 (Adenda 1, D) — a formatted description, as it is read. The HTML is sanitised HERE as well as on the server: whatever reaches this component, only the closed list of tags is
// drawn (see src/lib/rich-text.ts). An old description in plain text shows as its paragraphs. Styled by `.rich-text` in globals.css (lists, headings and links need it: Tailwind resets them).
import { renderDescription } from '@/lib/rich-text';

export function RichText({ value, className = '', testId }: { value: string | null | undefined; className?: string; testId?: string }) {
  const html = renderDescription(value);
  if (!html) return null;
  return <div className={`rich-text ${className}`} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}
