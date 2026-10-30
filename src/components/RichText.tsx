// Prompt 918 (Adenda 1, D) — a formatted description, as it is read. The HTML is sanitised HERE as well as on the server: whatever reaches this component, only the closed list of tags is
// drawn (see src/lib/rich-text.ts). An old description in plain text shows as its paragraphs. Styled by `.rich-text` in globals.css (lists, headings and links need it: Tailwind resets them).
import { renderDescription } from '@/lib/rich-text';
import { codesToTags, type MergeField } from '@/lib/merge-tags';

/** `mergeFields` (Prompt 924): a message that holds fields is shown with them as tags ("Applicant name"), not as `{applicant_name}`. */
export function RichText({ value, className = '', testId, mergeFields }: { value: string | null | undefined; className?: string; testId?: string; mergeFields?: MergeField[] }) {
  const html = mergeFields ? codesToTags(renderDescription(value), mergeFields) : renderDescription(value);
  if (!html) return null;
  return <div className={`rich-text ${className}`} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}
