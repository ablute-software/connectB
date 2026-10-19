// Prompt 918 D — the "Badges & awards" block an investor sees: ONLY badges Sherlock confirmed against a public source, each with its
// logo (or the icon for its kind), name, year, who verified it and when, and the link to the source. Drawn by one component for the
// investor's dossier and for the founder's "see how investors see this profile" preview, so the two can never drift apart.
//
// What it must never do, and the reasons the data it receives makes it impossible rather than merely unlikely:
//  · show anything unverified or disputed, or a count of them — the array it gets has only verified badges (projectBadgesForInvestor),
//    and it renders nothing at all for an empty one (no "0 badges", no placeholder: that would expose the founder's own gap);
//  · promise more than was done. The wording is "confirmed against public sources", never "guaranteed", "certified" or "validated by
//    Sherlock" as a guarantee (BADGES_INVESTOR_DISCLAIMER);
//  · show a verification note or the founder's evidence document — they are not on the type.
import type { BadgePublic } from '@/lib/company-badges';
import { BADGES_INVESTOR_DISCLAIMER, BADGE_KIND_LABEL, BADGE_VERIFIED_LABEL, formatBadgeDate, sourceDomain } from '@/lib/company-badges';
import { BadgeLogo } from '@/components/company/BadgeLogo';

export function InvestorBadges({ badges }: { badges: BadgePublic[] | null | undefined }) {
  if (!badges || badges.length === 0) return null;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3" data-section="Badges and awards">
      <h3 className="text-xs font-semibold text-gray-500">Badges &amp; awards</h3>
      <p className="mt-0.5 text-[11px] text-gray-400">{BADGES_INVESTOR_DISCLAIMER}</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {badges.map((b) => {
          const domain = sourceDomain(b.sourceUrl);
          return (
            <li key={b.id} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-2.5">
              <BadgeLogo src={b.logoUrl} kind={b.kind} className="h-12 w-12" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{BADGE_KIND_LABEL[b.kind]}</p>
                <p className="text-sm font-semibold leading-snug text-gray-900">
                  {b.name}{b.year ? <span className="font-normal text-gray-500"> · {b.year}</span> : null}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-[#0E7490]">{BADGE_VERIFIED_LABEL} · {formatBadgeDate(b.verifiedAt)}</p>
                <a href={b.sourceUrl} target="_blank" rel="noopener nofollow" title={b.sourceUrl}
                  className="mt-0.5 block truncate text-[11px] text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-[#0E7490]">
                  Source: <span className="font-medium text-gray-600">{domain || b.sourceUrl}</span>{b.sourceTitle && domain ? <span className="text-gray-400"> · {b.sourceTitle}</span> : null}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
