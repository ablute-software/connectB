// Nuno, 03/11/2026: the startups' FAQ tab, in five groups, with his questions and answers. The numbers that come from the product (plan prices, the monthly quota, the outreach targets, the countries)
// are read from where the product keeps them, so the text cannot drift from it; the wording is his.
import { PLANS } from '@/lib/plans';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from '@/lib/pipeline-unlock';
import { COUNTRIES_FLOOR, DEFAULT_DAILY_TARGET, DEFAULT_WEEKLY_TARGET } from './facts';

export interface FaqGroup { name: string; items: readonly (readonly [q: string, a: string])[] }

const [, garage, motherfunding] = PLANS;

export const STARTUP_FAQ_GROUPS: readonly FaqGroup[] = [
  {
    name: 'Finding investment',
    items: [
      ["Where do I start?", "Start with your own facts: stage, how much you're raising and what for, your country, and what you can show in a first meeting — a one-page summary, a deck and a few numbers you can defend. Sherlock Deal has you confirm these once, then matches investors and drafts messages from them."],
      ["How do I find investors who are a good fit for my startup?", "A good fit means your sector, stage, ticket size and geography — and the investor has been active recently. Sherlock Deal scores its whole catalogue against your company on those four and delivers the best matches to your pipeline each month."],
      ["How do I find investors for a startup in Portugal?", `Portugal's early-stage investors are a small, connected group: angels, a handful of seed funds, public-backed funds, corporate programmes and European funds backing Portuguese teams. Sherlock Deal's catalogue covers Portugal and ${COUNTRIES_FLOOR}+ other European countries, with geography as one of the four match criteria.`],
      ["How do I know whether my startup is ready to raise?", "You're ready when you can state your round — amount, instrument, use of funds, timeline — your deck and business plan agree, and you can answer investor questions cold. Sherlock Deal only shows you to investors once your core profile is complete, and the paid plans review your documents and train you on those questions first."],
      ["How do I approach an investor and prepare the first contact?", "Lead with fit: why this investor, what you do, one number that shows traction, and one small ask — a call, not feedback. Sherlock Deal drafts every message from your confirmed facts and the investor's profile; nothing sends without your review."],
    ],
  },
  {
    name: 'How Sherlock Deal helps',
    items: [
      ["What is Sherlock Deal and how does it help with fundraising?", "A fundraising workspace built in Portugal: it matches startups with investors that fit them, keeps your facts consistent everywhere, and runs outreach with daily and weekly targets. Founders use it pre-seed to Series A; investors use it from angels to funds and family offices."],
      ["How does Sherlock Deal assess alignment between a startup and an investor?", "On the criteria a mandate is written in — sector, stage, round size, country for founders; sectors, stages, cheque range, geography and instruments for investors, with exclusions that remove a startup outright. Fit is shown with the reasoning, as a guide, never a recommendation."],
      ["What's the difference between Sherlock Deal and an investor database?", "A database gives you names. Sherlock Deal gives you the investors that fit, their submission channel where one exists, a pipeline to run the round, protected outreach, an NDA-protected data room and, on paid plans, readiness reviews."],
      ["Does Sherlock Deal help improve my pitch deck and prepare for investor questions?", "Yes, on the paid plans: Readiness & Train reviews your documents, gives an investability reading and a prioritised action plan, and lets you practise investor questions. Every suggestion is a proposal — you accept or reject it."],
      ["Can I manage investor contacts and track my round in Sherlock Deal?", `Yes. Every investor sits in a pipeline with a stage, next step and history, and you can add your own without limit. Sherlock Deal sets daily and weekly outreach targets (${DEFAULT_DAILY_TARGET}/day, ${DEFAULT_WEEKLY_TARGET}/week by default) and resurfaces cold investors when your facts change.`],
    ],
  },
  {
    name: 'Getting started and sharing information',
    items: [
      ["Can I use Sherlock Deal at an early stage, or without a pitch deck?", "Yes — build your profile from your company facts alone and add a deck later. Investors only see you once your core profile is complete, and you can hide your company at any time."],
      ["Is Sherlock Deal only for Portuguese startups?", `No. It was built in Portugal, but any startup can join; the investor catalogue covers ${COUNTRIES_FLOOR}+ European countries, so matches are strongest for startups raising from European investors.`],
      ["Do investors get automatic access to my documents and company information?", "No. Investors see only what you've chosen to show, once your core profile is complete, and access grows in steps — overview, then team and traction if you grant them, then documents through the data room, NDA-gated if you choose. Your outreach activity and notes are never shown to investors."],
      ["Can I use Sherlock Deal for free?", `Yes — the Free plan is €0 forever, no card needed: profile, data room, protected outreach, MatchDeal and up to ${PLAN_PIPELINE_MONTHLY_ADDITION.idea} new curated investors a month. Paid plans (€${garage.monthlyEur} and €${motherfunding.monthlyEur}/month) raise those limits and add AI-drafted messages and Readiness & Train.`],
      ["Does Sherlock Deal invest directly, or guarantee that I'll raise?", "No, to both. It's a tool, not a fund or broker — it doesn't invest, advise or guarantee a response, and runs on subscription only. Every deal happens directly between you and the investor."],
    ],
  },
  {
    name: 'Fundraising and first contact',
    items: [
      ["What is \"first contact\" in fundraising, and why does it matter?", "It's the first time an investor hears from you, and it sets the frame for everything after — in scope and ready gets acted on, out of scope gets ignored. Sherlock Deal matches before you write and drafts from confirmed facts, so first contact starts in scope."],
      ["How many investors should a startup contact to close a pre-seed or seed round?", `Dozens, not hundreds — a shorter list of well-matched investors, worked in waves, beats mass-emailing. Sherlock Deal paces this at ${DEFAULT_DAILY_TARGET} a day and ${DEFAULT_WEEKLY_TARGET} a week by default, so you can follow up properly.`],
      ["What do investors want to see before a first meeting?", "Three things: what you do and for whom in one page, a few numbers you can defend, and a round that makes sense — amount, instrument, use of funds. Sherlock Deal keeps these consistent across your profile, messages and data room."],
    ],
  },
  {
    name: 'For investors and ecosystem organisations',
    items: [
      ["How do investors find startups that match their investment thesis?", "By writing the thesis as criteria — sectors, stages, cheque range, geography, instruments, exclusions — and measuring startups against it. On Sherlock Deal an investor builds a mandate once; matching startups arrive in curated waves, browsing stays private, and introductions need both sides to opt in."],
      ["Is Sherlock Deal a platform for incubators and accelerators?", "Yes. Programmes get their own workspace: invite startups into a portfolio, see what each founder chooses to share, publish open calls and manage their team. The founder decides what's shared — documents and fundraising details stay out of it."],
    ],
  },
];

/** Every question with its answer, flat (the structured data of the page reads this). */
export const STARTUP_FAQ_FLAT: readonly (readonly [string, string])[] = STARTUP_FAQ_GROUPS.flatMap((g) => g.items);
