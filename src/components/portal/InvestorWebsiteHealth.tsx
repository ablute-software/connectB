// Prompt 919 D — what an investor sees of a startup's website health, when (and only when) the founder switched it on: four numbers from
// Google's public PageSpeed check, the strategy, the date, and Google's own report. Nothing else exists to show: the data this component
// receives has no summary and no findings (projectWebsiteHealthForInvestor), and it draws NO verdict — no colour scale, no "good" or
// "poor", no comparison with other startups, no label about the people behind the company. Drawn by one component for the investor's
// dossier and for the founder's "see how investors see this profile" preview, so the two cannot drift apart.
import { formatCheckedDate, type WebsiteHealthPublic } from '@/lib/website-health';

export const WEBSITE_HEALTH_TOOLTIP = "Public measurement by Google of the company's website. Shared by the founder.";

export function InvestorWebsiteHealth({ websiteHealth }: { websiteHealth: WebsiteHealthPublic | null | undefined }) {
  if (!websiteHealth) return null;
  const { scores } = websiteHealth;
  const items: [string, number][] = [
    ['Performance', scores.performance], ['SEO', scores.seo], ['Accessibility', scores.accessibility], ['Best practices', scores.bestPractices],
  ];
  return (
    <div className="mt-3 border-t border-gray-100 pt-3" data-section="Website health" title={WEBSITE_HEALTH_TOOLTIP}>
      <h3 className="text-xs font-semibold text-gray-500">
        Website health
        <span className="font-normal text-gray-400"> · Google PageSpeed (mobile) · checked {formatCheckedDate(websiteHealth.checkedAt)}</span>
      </h3>
      <p className="sr-only">{WEBSITE_HEALTH_TOOLTIP}</p>
      <dl className="mt-1.5 flex flex-wrap gap-2">
        {items.map(([label, n]) => (
          <div key={label} className="min-w-[4.5rem] rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-center">
            <dd className="text-sm font-semibold tabular-nums text-gray-800">{n}</dd>
            <dt className="text-[10px] text-gray-500">{label}</dt>
          </div>
        ))}
      </dl>
      <a href={websiteHealth.reportUrl} target="_blank" rel="noopener nofollow"
        className="mt-1 inline-block text-[11px] text-gray-400 underline decoration-gray-300 underline-offset-2 hover:text-[#0E7490]">
        Google&apos;s full report
      </a>
    </div>
  );
}
