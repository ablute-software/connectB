// Prompt 80 §1 — the investor ticket-range slider's special step table:
// 10,000 -> 15,000 -> 25,000, then uniform 25,000 steps up to 50,000,000.
// That's ~2000 valid stops — a literal 1:1 linear drag would need ~2000
// distinct handle positions along the track, impractical to hit precisely
// by touch or mouse. Per the spec's own pre-authorization ("se isso tornar
// o arrasto impraticável, tragam uma proposta de UX... mas perguntem"): the
// REACHABLE VALUES stay exactly this table, only how far you drag to reach
// a given value changes — a log-scale position-to-value mapping gives low
// tickets (10k-1M) proportionally more of the drag range than the long
// 1M-50M tail, instead of every pixel meaning +25k regardless of altitude.
export const TICKET_MIN_EUR = 10_000;
export const TICKET_MAX_EUR = 50_000_000;

const GRID_STEP = 25_000;
const GRID_START = 25_000;

// Built once per module load — 2000 numbers is trivial memory, no reason
// to rebuild on every render.
let cachedStops: number[] | null = null;
export function ticketStops(): number[] {
  if (cachedStops) return cachedStops;
  const stops: number[] = [10_000, 15_000];
  for (let v = GRID_START; v <= TICKET_MAX_EUR; v += GRID_STEP) stops.push(v);
  cachedStops = stops;
  return stops;
}

export function nearestTicketStop(value: number): number {
  const stops = ticketStops();
  if (value <= stops[0]) return stops[0];
  if (value >= stops[stops.length - 1]) return stops[stops.length - 1];
  let lo = 0;
  let hi = stops.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stops[mid] <= value) lo = mid; else hi = mid;
  }
  return value - stops[lo] <= stops[hi] - value ? stops[lo] : stops[hi];
}

// Slider position <-> euro value. Position is a plain 0..POSITION_MAX
// integer (not a 0..1 float) so <input type="range"> can use whole-number
// steps without float-rounding jitter between renders.
export const POSITION_MAX = 1000;
const LOG_MIN = Math.log(TICKET_MIN_EUR);
const LOG_MAX = Math.log(TICKET_MAX_EUR);

export function positionToTicket(position: number): number {
  const t = position / POSITION_MAX;
  const raw = Math.exp(LOG_MIN + t * (LOG_MAX - LOG_MIN));
  return nearestTicketStop(raw);
}

export function ticketToPosition(value: number): number {
  const snapped = nearestTicketStop(value);
  const t = (Math.log(snapped) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return Math.round(t * POSITION_MAX);
}

export function formatTicketEur(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `€${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (value >= 1_000) return `€${Math.round(value / 1000)}k`;
  return `€${value}`;
}
