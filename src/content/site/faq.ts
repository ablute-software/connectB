// Prompt 920 — the 20 questions of /faq (and the five of /for-startups), in one place. The approved text is in docs/site-copy-920.md §5;
// every claim in it was checked against the code and production on 16/10/2026 (the table in §0.3 of that file gives the source of each).
//
// Rules this file keeps, and site-content.test.ts enforces:
//   · the first sentence of an answer answers on its own — no "it depends";
//   · "Sherlock Deal" is written out in full at least once per group;
//   · a number is either one of the constants in facts.ts or is read from plans.ts / pipeline-unlock.ts — nothing is typed in here that
//     the product could contradict later (that is how the first draft ended up promising "readiness tools" on the Free plan);
//   · inline links are written [label](href) and rendered by InlineText; the JSON-LD gets the plain text, so the schema can never say
//     something the page does not show.
import { PLANS } from '@/lib/plans';
import { PLAN_PIPELINE_MONTHLY_ADDITION } from '@/lib/pipeline-unlock';
import { COUNTRIES_FLOOR, DAILY_TARGET_WORDS as daily, WEEKLY_TARGET_WORDS as weekly } from './facts';

export interface FaqItem { id: string; q: string; a: string }
export interface FaqGroup { id: string; title: string; items: FaqItem[] }

export function buildFaqGroups(): FaqGroup[] {
  const free = PLANS.find((p) => p.tier === 'idea')!;
  const garage = PLANS.find((p) => p.tier === 'garage')!;
  const butler = PLANS.find((p) => p.tier === 'motherfunding')!;

  return [
    {
      id: 'finding-investment',
      title: 'Finding investment',
      items: [
        {
          id: 'where-do-i-start',
          q: "I'm looking for investment for my startup. Where do I start?",
          a: 'Start with the facts about your own company: your stage, how much you are raising and what for, your country, and what you can show an investor in a first meeting — a one-page summary, a deck and the few numbers you can defend. Only then look for investors, because who fits depends on those facts. Sherlock Deal starts there too: you confirm your company facts once, and every investor match and every message uses only facts you have confirmed.',
        },
        {
          id: 'good-fit-investors',
          q: 'How do I find investors who are a good fit for my startup?',
          a: "A good-fit investor invests in your sector, at your stage, with cheques that suit your round and in your geography — and has been active recently. Check those four against each investor's published thesis, then look at their latest investments. Sherlock Deal does the first part for you: it scores every investor in its catalogue against your company on sector, stage, ticket size and geography, and delivers the best matches to your pipeline each month, with each investor's thesis, stage range and cheque size on file so you can check the fit yourself. See [how to find the right investors for your startup](/for-startups).",
        },
        {
          id: 'investors-in-portugal',
          q: 'How do I find investors for a startup in Portugal?',
          a: `Portugal's early-stage investors are a small, well-connected group: business angels and angel networks, a handful of seed funds, public-backed funds, corporate programmes, and European funds that back Portuguese teams. Sherlock Deal was built in Portugal: its catalogue of verified investors covers Portugal and more than ${COUNTRIES_FLOOR} other European countries, and geography is one of the four things every match is scored on.`,
        },
        {
          id: 'ready-to-raise',
          q: 'How do I know whether my startup is ready to raise?',
          a: 'You are ready when you can state your round — amount, instrument, use of funds and timeline — when your deck and business plan tell the same story, and when you can answer the questions every investor asks without looking anything up. Sherlock Deal helps in two ways. Your company becomes visible to investors only once its core profile is complete — nine basic facts, such as website, sector, stage, country and round size — and, on the paid plans, Readiness & Train reviews your documents, flags gaps and trains you on investor questions before you start.',
        },
        {
          id: 'first-contact-approach',
          q: 'How do I approach an investor and prepare the first contact?',
          a: 'Lead with fit: one sentence on why this investor, one on what you do, one number that shows traction or progress, and one clear ask — a 20-minute call, not "feedback". Keep it short. In Sherlock Deal every message is drafted from your confirmed facts and the investor\'s profile — templates on every plan, AI-personalised drafts on the paid plans — and nothing is sent until you have reviewed it and clicked.',
        },
      ],
    },
    {
      id: 'how-sherlock-deal-helps',
      title: 'How Sherlock Deal helps',
      items: [
        {
          id: 'what-is-sherlock-deal',
          q: 'What is Sherlock Deal and how does it help with fundraising?',
          a: 'Sherlock Deal is a fundraising workspace built in Portugal. It matches startups with the investors that fit them, keeps a startup\'s confirmed facts consistent across every message and document, runs the outreach pipeline with daily and weekly targets, and puts startups that match an investor\'s mandate in front of that investor. Founders use it to raise from pre-seed to Series A; investors use it from business angels to funds, family offices and ecosystem organisations.',
        },
        {
          id: 'how-alignment-is-assessed',
          q: 'How does Sherlock Deal assess alignment between a startup and an investor?',
          a: "On the criteria a mandate is written in. For founders, each investor in the catalogue is scored against the startup's sector, stage, round size and country, using what has been compiled and verified about the investor from public sources. For investors, startups are scored against the mandate the investor wrote — sectors, stages, cheque range, geographies and instruments — and an exclusion removes a startup outright. Founders see a fit rating next to the investor's own thesis, stage range and cheque size; investors see the match with the criteria that were met. A score is a guide, not a recommendation, and it never replaces your own judgement.",
        },
        {
          id: 'difference-from-a-database',
          q: "What's the difference between Sherlock Deal and an investor database?",
          a: 'A database gives you names. Sherlock Deal gives you the investors that fit your company, with the channel each one publishes for submissions where one exists, the pipeline to run the round, protected outreach (message checks, daily limits, contact locks), an NDA-protected data room and, on the paid plans, readiness reviews. A database is an input; Sherlock Deal is the process.',
        },
        {
          id: 'pitch-deck-and-questions',
          q: 'Does Sherlock Deal help improve my pitch deck and prepare for investor questions?',
          a: 'Yes, on the paid plans. Readiness & Train reviews your documents with AI, gives an investability reading and a prioritised action plan, and lets you practise the questions investors ask. Every suggestion is a proposal: you accept or reject it.',
        },
        {
          id: 'manage-contacts-and-round',
          q: 'Can I manage investor contacts and track my round in Sherlock Deal?',
          a: `Yes. Every investor you work with sits in a pipeline with a stage, a next step and a history, and you can add your own investors without limit. Sherlock Deal sets daily and weekly outreach targets (${daily} a day and ${weekly} a week by default), tracks follow-ups, and suggests investors from earlier conversations who deserve a second look when your facts change.`,
        },
      ],
    },
    {
      id: 'getting-started',
      title: 'Getting started and sharing information',
      items: [
        {
          id: 'early-stage-no-deck',
          q: 'Can I use Sherlock Deal at an early stage, or without a pitch deck?',
          a: 'Yes. You can create an account and build your profile from your company facts alone, and add a deck and a business plan when you have them. Investors see your company only once its core profile is complete, and you can hide it at any time, so there is no harm in starting early.',
        },
        {
          id: 'only-portuguese-startups',
          q: 'Is Sherlock Deal only for Portuguese startups?',
          a: `No. Sherlock Deal was built in Portugal, but a startup from any country can create an account. The investor catalogue is European — verified investors in more than ${COUNTRIES_FLOOR} countries — so matches are strongest for startups raising from European investors.`,
        },
        {
          id: 'access-to-documents',
          q: 'Do investors get automatic access to my documents and company information?',
          a: 'No. Investors see the profile you have chosen to show, and only once your core profile is complete; you can hide your company at any time. What an investor learns grows in steps: the company overview once the investor expresses interest, team and traction details only if you grant them, and documents only through the data room. The data room is yours to control: you open each document, to each investor, and can require an NDA first. Sherlock Deal never shows investors your internal performance data — your outreach activity, your notes, or where you stand with other investors.',
        },
        {
          id: 'free-plan',
          q: 'Can I use Sherlock Deal for free?',
          a: `Yes. The Free plan, "${free.name}", costs €${free.monthlyEur} with no card required and no time limit. It includes your company profile and confirmed facts, a data room with access control and NDA-protected sharing, protected outreach, the MatchDeal discovery app, and up to ${PLAN_PIPELINE_MONTHLY_ADDITION.idea} new curated investors a month once your profile has enough information to curate for. The paid plans — "${garage.name}" at €${garage.monthlyEur} a month and "${butler.name}" at €${butler.monthlyEur} a month, less when billed annually — raise those limits and add AI-personalised drafts and Readiness & Train. Every plan is listed in the [pricing section](/#pricing).`,
        },
        {
          id: 'invest-or-guarantee',
          q: "Does Sherlock Deal invest directly, or guarantee that I'll raise?",
          a: 'No, on both counts. Sherlock Deal is a tool, not a fund and not a broker: it does not invest, give investment advice or hold funds, and it cannot guarantee that you will raise or that any investor will respond. What it does is help you reach the right investors, with consistent facts, at a steady pace. Today it is paid for by subscription only. Any decision and any deal happen directly between you and the investor.',
        },
      ],
    },
    {
      id: 'fundraising-and-first-contact',
      title: 'Fundraising and first contact',
      items: [
        {
          id: 'what-is-first-contact',
          q: 'What is "first contact" in fundraising, and why does it matter?',
          a: 'First contact is the first time an investor hears from a startup, and it sets the frame for what follows. A first contact that is clearly in scope — right sector, stage and cheque size, with the key facts ready — is easy for an investor to act on; one that is out of scope is easy to ignore. For founders, Sherlock Deal helps make the first contact a fit: it matches before you write, and drafts from confirmed facts. For investors, it brings startups that match the mandate into a curated pipeline, so the first conversation is with a startup that already fits; introductions happen only when both sides opt in.',
        },
        {
          id: 'how-many-investors',
          q: 'How many investors should a startup contact to close a pre-seed or seed round?',
          a: `Dozens, not hundreds: most founders work a list of a few dozen well-matched investors, in waves, rather than mass-emailing. A shorter list of investors who really fit beats a long list of ones who do not, because fit decides who replies. Sherlock Deal paces outreach — ${daily} contacts a day and ${weekly} a week by default — so you can work a list in waves and follow up properly.`,
        },
        {
          id: 'what-investors-want-to-see',
          q: 'What do investors want to see before a first meeting?',
          a: 'Three things: a clear statement of what you do and for whom, in one page; evidence of progress — a few numbers you can defend, such as revenue, users, pilots or milestones; and a round that makes sense — amount, instrument and use of funds. A deck helps, but most investors decide from the first page whether to take the meeting. Sherlock Deal keeps these facts consistent across your profile, your messages and your data room. See [how to find the right investors for your startup](/for-startups).',
        },
      ],
    },
    {
      id: 'investors-and-ecosystem',
      title: 'For investors and ecosystem organisations',
      items: [
        {
          id: 'how-investors-find-startups',
          q: 'How do investors find startups that match their investment thesis?',
          a: 'They write the thesis down as criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have startups measured against it, instead of waiting for introductions. On Sherlock Deal an investor builds a mandate once; startups that match it arrive in curated waves, scored against the mandate with the criteria shown; browsing is private, and an introduction happens only when both sides opt in. See [Sherlock Deal for investors](/investors).',
        },
        {
          id: 'incubators-and-accelerators',
          q: 'Is Sherlock Deal a platform for incubators and accelerators?',
          a: 'Yes. Incubators, accelerators, university and corporate programmes, public agencies and other ecosystem organisations have their own workspace: they invite their startups into a portfolio, see what each founder chooses to share — the company profile, confirmed facts and roadmap, and optionally the readiness analysis — publish open calls for applications, and manage their team. The founder decides what is shared; documents and fundraising details are not shared with a programme.',
        },
      ],
    },
  ];
}

/** Every question, in page order. */
export function allFaqItems(): FaqItem[] {
  return buildFaqGroups().flatMap((g) => g.items);
}

/** The five "Finding investment" questions /for-startups repeats (same strings, same module — they cannot drift from /faq). */
export function findingInvestmentItems(): FaqItem[] {
  return buildFaqGroups().find((g) => g.id === 'finding-investment')!.items;
}
