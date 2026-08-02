import { describe, expect, it } from 'vitest';
import {
  TICKET_MIN_EUR, TICKET_MAX_EUR, POSITION_MAX,
  ticketStops, nearestTicketStop, positionToTicket, ticketToPosition, formatTicketEur,
} from './ticket-range';

describe('ticketStops (the exact step table from the spec)', () => {
  it('starts 10k, 15k, then a uniform 25k grid up to 50M', () => {
    const stops = ticketStops();
    expect(stops[0]).toBe(10_000);
    expect(stops[1]).toBe(15_000);
    expect(stops[2]).toBe(25_000);
    expect(stops[3]).toBe(50_000);
    expect(stops[stops.length - 1]).toBe(TICKET_MAX_EUR);
  });

  it('is strictly increasing with no duplicate or skipped grid steps', () => {
    const stops = ticketStops();
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
    for (let i = 3; i < stops.length; i += 1) {
      expect(stops[i] - stops[i - 1]).toBe(25_000);
    }
  });
});

describe('nearestTicketStop', () => {
  it('snaps to the closer of two neighboring stops', () => {
    expect(nearestTicketStop(11_000)).toBe(10_000);
    expect(nearestTicketStop(13_000)).toBe(15_000);
    expect(nearestTicketStop(37_499)).toBe(25_000);
    expect(nearestTicketStop(37_501)).toBe(50_000);
  });

  it('clamps outside the valid range', () => {
    expect(nearestTicketStop(0)).toBe(TICKET_MIN_EUR);
    expect(nearestTicketStop(100_000_000)).toBe(TICKET_MAX_EUR);
  });
});

describe('positionToTicket / ticketToPosition (log-scale drag mapping)', () => {
  it('round-trips the endpoints exactly', () => {
    expect(positionToTicket(0)).toBe(TICKET_MIN_EUR);
    expect(positionToTicket(POSITION_MAX)).toBe(TICKET_MAX_EUR);
    expect(ticketToPosition(TICKET_MIN_EUR)).toBe(0);
    expect(ticketToPosition(TICKET_MAX_EUR)).toBe(POSITION_MAX);
  });

  it('is monotonically non-decreasing across the whole position range', () => {
    let prev = positionToTicket(0);
    for (let p = 1; p <= POSITION_MAX; p += 1) {
      const v = positionToTicket(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('every position maps to a value from the real stop table, never an arbitrary number', () => {
    const stops = new Set(ticketStops());
    for (let p = 0; p <= POSITION_MAX; p += 50) {
      expect(stops.has(positionToTicket(p))).toBe(true);
    }
  });

  it('gives low tickets proportionally more drag distance than the high end', () => {
    // 10k -> 1M should take noticeably more slider travel than 1M -> 50M,
    // even though the 1M-50M span is far larger in raw euros — that's the
    // whole point of the log scale.
    const posAt1M = ticketToPosition(1_000_000);
    const lowSpan = posAt1M - 0;
    const highSpan = POSITION_MAX - posAt1M;
    expect(lowSpan).toBeGreaterThan(highSpan);
  });
});

describe('formatTicketEur', () => {
  it('formats thousands and millions', () => {
    expect(formatTicketEur(10_000)).toBe('€10k');
    expect(formatTicketEur(1_000_000)).toBe('€1M');
    expect(formatTicketEur(1_500_000)).toBe('€1.5M');
    expect(formatTicketEur(50_000_000)).toBe('€50M');
  });
});
