'use client';
// Prompt 907 (I1) — the header of a call as an applicant sees it at the top of its link (spec §13.1): who promotes it, its title, the
// deadline with its time zone, the summary, the eligibility in sentences (none until Etapa 2 configures eligibility), the regulation PDF
// when the team made one public, and — while applications cannot be made — one sentence saying so ("Opens on …", "Applications closed on …").
//
// Prompt 918 (Adenda 1, C and D): the ENTRY page. Before registering or filling in anything, the applicant sees a page of presentation, almost a cover: the call's cover image (or a band in
// the platform's colour), the logo of the entity — better than only its name, which stays under it, smaller —, the title, the dates, the description (now with formatting) and the regulation, and
// one clear button: "Start application" (or "Continue your application"). The form pages, the applicant's list and the emails carry the same logo and title, small.
import { formatInZone } from '@/lib/calls/tz';
import { RichText } from '@/components/RichText';
import { CoverBand, EntityLogo, LogoTile } from './Pictures';

export { EntityLogo };

export interface PublicCallInfo {
  name: string; description: string | null; promoter: string;
  opensAt: string | null; closesAt: string | null; timezone: string;
  phase: 'open' | 'scheduled' | 'closed'; message: string | null;
  eligibility: string[]; regulation: { fileName: string; url: string } | null;
  /** The cover image and the entity's logo (Prompt 918, Adenda 1 C): addresses on this platform, or — for a profile logo — an https address. Null when there is none. */
  coverUrl?: string | null; logoUrl?: string | null;
}

export function CallHeader({ call, showPromoter = true }: { call: PublicCallInfo; showPromoter?: boolean }) {
  return (
    <header data-testid="call-header">
      {showPromoter && <p className="text-xs font-medium uppercase tracking-wide text-gray-400" data-testid="call-promoter">{call.promoter}</p>}
      <h1 className={`${showPromoter ? 'mt-1' : ''} text-xl font-bold text-gray-900 sm:text-2xl`} data-testid="call-name">{call.name}</h1>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-400">Opens</dt><dd className="text-gray-800">{formatInZone(call.opensAt, call.timezone)}</dd>
        <dt className="text-gray-400">Deadline</dt><dd className="font-medium text-gray-900" data-testid="call-deadline">{formatInZone(call.closesAt, call.timezone)}</dd>
      </dl>
      {call.description && <RichText value={call.description} className="mt-4 text-sm text-gray-600" testId="call-summary" />}
      {call.eligibility.length > 0 && (
        <div className="mt-4" data-testid="call-eligibility">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Who can apply</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">{call.eligibility.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {call.regulation && (
        <p className="mt-2 text-sm">
          <a href={call.regulation.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center font-medium text-[#0E7490] hover:underline" data-testid="regulation-link">
            Read the regulation (PDF)
          </a>
          <span className="ml-1 text-xs text-gray-400">{call.regulation.fileName}</span>
        </p>
      )}
      {call.message && (
        <p className="mt-5 rounded-lg bg-[#E8F4F8] px-4 py-3 text-sm font-medium text-[#0E7490]" data-testid="call-message">{call.message}</p>
      )}
    </header>
  );
}

/**
 * The entry page's card: the cover (lower on a phone), the logo over its edge with the entity's name under it, the call's information, and the button — which stays in view at the bottom of a
 * phone's screen. `cta` is null while there is nothing to start (a closed call with no application).
 */
export function CallIntro({ call, cta, onStart }: { call: PublicCallInfo; cta: string | null; onStart: () => void }) {
  return (
    <section data-testid="call-intro">
      <CoverBand url={call.coverUrl} />
      <div className="px-5 pb-2 sm:px-8">
        <div className="-mt-9 flex items-end gap-3 sm:-mt-11">
          <LogoTile url={call.logoUrl} name={call.promoter} />
        </div>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500" data-testid="call-promoter">{call.promoter}</p>
        <div className="mt-1"><CallHeader call={call} showPromoter={false} /></div>
      </div>
      {!cta && (
        <div className="px-5 pb-6 pt-2 sm:px-8">
          <button type="button" onClick={onStart} data-testid="intro-signin" className="min-h-[44px] text-sm font-medium text-[#0E7490] hover:underline">Already applied? Sign in to see your application</button>
        </div>
      )}
      {cta && (
        <div className="sticky bottom-0 z-10 mt-6 rounded-b-2xl border-t border-gray-100 bg-white/95 px-5 py-3 sm:px-8 sm:py-4" data-testid="intro-cta-bar">
          <button type="button" onClick={onStart} data-testid="start-application"
            className="min-h-[48px] w-full rounded-xl bg-[#0E7490] px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#0c637b] sm:w-auto sm:min-w-[14rem]">{cta}</button>
        </div>
      )}
    </section>
  );
}

/** The same header, small: the logo, the entity and the call's title — at the top of the form pages. */
export function CallMiniHeader({ call, onAbout }: { call: PublicCallInfo; onAbout?: () => void }) {
  return (
    <div className="flex items-center gap-3" data-testid="call-mini-header">
      <EntityLogo url={call.logoUrl} name={call.promoter} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-400">{call.promoter}</p>
        <p className="truncate text-sm font-semibold text-gray-900" data-testid="mini-name">{call.name}</p>
      </div>
      {onAbout && <button type="button" onClick={onAbout} className="min-h-[44px] shrink-0 px-2 text-xs font-medium text-[#0E7490] hover:underline" data-testid="about-call">About this call</button>}
    </div>
  );
}

/** The button of the entry page: what it says depends on what the person already has on this call. */
export function ctaLabel(phase: PublicCallInfo['phase'], application: { status: 'draft' | 'submitted' } | null | undefined): string | null {
  if (application?.status === 'submitted') return 'View your application';
  if (application?.status === 'draft') return 'Continue your application';
  return phase === 'open' ? 'Start application' : null;
}
