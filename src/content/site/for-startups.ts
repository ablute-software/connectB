// Prompt 920 — the text of /for-startups. Approved in docs/site-copy-920.md §2. The steps are data (not JSX) because the HowTo schema
// is built from the same list the page draws, and the numbers about plans are read from the product, never typed here.
import { PLAN_PIPELINE_MONTHLY_ADDITION } from '@/lib/pipeline-unlock';
import { CATALOGUE_STATEMENT, DAILY_TARGET_WORDS, WEEKLY_TARGET_WORDS } from './facts';

export const FOR_STARTUPS_H1 = 'How to find the right investors for your startup (and why most lists fail)';

export const FOR_STARTUPS_ANSWER =
  'The right investors for your startup are the ones whose mandate already covers your sector, your stage, your round size and your country — and who have invested recently. Build a short list on those four facts, confirm your own numbers once, and approach each investor with one clear reason why you fit. Sherlock Deal does the matching for you.';

export const LISTS_FAIL_INTRO = 'A list of investor names is a starting point, not a plan. Most lists fail for the same four reasons.';

export const LISTS_FAIL: { lead: string; text: string }[] = [
  { lead: 'They are not matched to you.', text: 'A fund that invests only at Series A, or only in climate, will not answer a pre-seed health-tech founder, however good the pitch.' },
  { lead: 'They go stale.', text: 'Funds close, partners move on and cheque sizes change. A list copied a year ago sends you to investors who no longer fit.' },
  { lead: 'They give you a name, not a reason.', text: 'Without a reason why this investor and why now, your message looks like every other one in the inbox.' },
  { lead: 'They have no order.', text: 'A hundred names with no ranking turns a round into a mailing exercise instead of a series of well-prepared conversations.' },
];

/** The five steps. `name` is the bold lead of each step and the HowToStep name; `text` is the rest. */
export const FOR_STARTUPS_STEPS: { name: string; text: string }[] = [
  { name: 'Get your own facts straight first', text: 'Write down your sector, stage and country, how much you are raising, in which instrument, and what the money is for. Investors compare notes: a number that changes between conversations costs you credibility.' },
  { name: 'Match on sector and stage', text: 'Investors publish the sectors they back and the stages they invest in. Remove everyone whose stage range does not include yours or whose sectors do not include yours.' },
  { name: 'Match on cheque size and geography', text: "Compare your round with the investor's typical cheque, and check where the investor invests: many funds invest only in certain countries or regions." },
  { name: 'Check recent activity', text: 'Look at what the investor has backed over the last year or two. Is it your sector? Is it your stage? Is a new fund being deployed? An investor who has not made an investment in your area recently is a weaker bet than one who has.' },
  { name: 'Plan the first contact', text: 'One sentence on why this investor, one on what you do, one number that shows progress, and a clear ask — a 20-minute call, not "feedback". Have a one-page summary, a deck and the basic documents ready before you send anything.' },
];

/** "How Sherlock Deal does this for you" — two paragraphs; the plan quotas are the product's own (pipeline-unlock.ts). */
export function sherlockDoesThisParagraphs(): [string, string] {
  const q = PLAN_PIPELINE_MONTHLY_ADDITION;
  return [
    `Sherlock Deal turns the method into a workflow. You confirm your company facts once. Sherlock Deal then scores every investor in its catalogue — ${CATALOGUE_STATEMENT} — against your company on sector, stage, ticket size and geography, and delivers the best matches to your pipeline every month. The Free plan brings up to ${q.idea} new curated investors a month; the paid plans bring up to ${q.garage} and up to ${q.motherfunding} (curation starts once your profile has enough information to curate for). Each investor comes with their thesis, stage range, cheque size, the latest investment found where it is known, and the channel they publish for submissions, so you can check the fit yourself before you write.`,
    `Outreach then runs with discipline: daily and weekly targets you set (${DAILY_TARGET_WORDS} a day and ${WEEKLY_TARGET_WORDS} a week by default), messages drafted from your confirmed facts and checked before they go, rules that stop you from contacting the same investor twice by accident, and nothing sent without your click. Documents go out through a data room with access set per investor and NDA protection where you want it. When your facts change, Sherlock Deal suggests investors from earlier conversations who deserve a second look.`,
  ];
}
