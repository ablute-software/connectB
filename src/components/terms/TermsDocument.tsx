'use client';
// Prompt 341 §C — the ONE render of the legal text, reused by both the
// public /terms page and the acceptance popup's "read the full text"
// reader (two wrappers, same component, per the prompt's own instruction).
// A tiny purpose-built line parser rather than a markdown dependency: the
// source text only ever uses headings, bold, a blockquote, a horizontal
// rule and one italic closing note — see terms.ts's own header on why the
// text itself must never be summarized, paraphrased or "improved" here.
// This renders it, unedited, with heading anchors added for clause
// navigation; nothing about the wording is ever touched.
import { getTermsMarkdown, TERMS_VERSION } from '@/lib/terms';

function slugify(heading: string): string {
  const numbered = heading.match(/^(\d+)\./);
  if (numbered) return `clause-${numbered[1]}`;
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\[([^\]]+?)\]\(([^)]+?)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) parts.push(<strong key={`${keyPrefix}-${i++}`}>{match[1]}</strong>);
    else parts.push(<a key={`${keyPrefix}-${i++}`} href={match[3]} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{match[2]}</a>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function TermsDocument({ version = TERMS_VERSION }: { version?: string }) {
  const lines = getTermsMarkdown(version).split('\n');
  const blocks: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const k = key++;
    if (line.startsWith('# ')) {
      blocks.push(<h1 key={k} className="text-xl font-bold text-gray-900">{renderInline(line.slice(2), `h1-${k}`)}</h1>);
    } else if (line.startsWith('## ')) {
      const text = line.slice(3);
      blocks.push(<h2 id={slugify(text)} key={k} className="mt-6 scroll-mt-20 text-lg font-semibold text-gray-900">{renderInline(text, `h2-${k}`)}</h2>);
    } else if (line.startsWith('### ')) {
      const text = line.slice(4);
      blocks.push(<h3 id={slugify(text)} key={k} className="mt-5 scroll-mt-20 text-base font-semibold text-gray-900">{renderInline(text, `h3-${k}`)}</h3>);
    } else if (line.startsWith('> ')) {
      blocks.push(<blockquote key={k} className="mt-3 border-l-2 border-gray-300 pl-3 text-sm italic text-gray-600">{renderInline(line.slice(2), `bq-${k}`)}</blockquote>);
    } else if (line.trim() === '---') {
      blocks.push(<hr key={k} className="my-5 border-gray-200" />);
    } else if (line.startsWith('*[') && line.endsWith(']*')) {
      blocks.push(<p key={k} className="mt-5 text-xs italic text-gray-400">{line.slice(1, -1)}</p>);
    } else {
      blocks.push(<p key={k} className="mt-2 text-sm leading-relaxed text-gray-700">{renderInline(line, `p-${k}`)}</p>);
    }
  }

  return <div className="terms-document">{blocks}</div>;
}
