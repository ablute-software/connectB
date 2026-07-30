import { describe, expect, it } from 'vitest';
import { describeAuditEvent, type AuditLogRow } from './audit-log-format';

function row(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: '1', admin_user_id: 'u1', action: 'catalog_create', subject_type: 'catalog_entity',
    subject_id: null, detail: null, created_at: '2026-07-30T10:00:00Z', ...overrides,
  };
}

describe('describeAuditEvent', () => {
  it('formats promo_code_created matching the real example from Prompt 69', () => {
    const s = describeAuditEvent(
      row({ action: 'promo_code_created', detail: { code: 'ALEXOFFER100', kind: 'free_trial', discount_pct: 100 } }),
      'alexandrameira',
    );
    expect(s).toBe('alexandrameira created promo code ALEXOFFER100 (free_trial, 100% off)');
  });

  it('formats catalog_merge with the losing entity names, not the winner', () => {
    const s = describeAuditEvent(
      row({ action: 'catalog_merge', detail: { mergedFrom: [{ id: 'a', name: 'Faber Ventures' }, { id: 'b', name: 'Faber' }] } }),
      'nunomarujo',
    );
    expect(s).toBe('nunomarujo merged 2 duplicate(s) (Faber Ventures, Faber) into one catalog entity');
  });

  it('formats contribution_verified with field and value', () => {
    const s = describeAuditEvent(row({ action: 'contribution_verified', detail: { field: 'hq_city', value: 'Rio de Janeiro' } }), 'nunomarujo');
    expect(s).toBe('nunomarujo confirmed a contribution: hq_city → "Rio de Janeiro"');
  });

  it('never returns blank for an unrecognized action', () => {
    const s = describeAuditEvent(row({ action: 'some_future_action', subject_type: 'widget' }), 'nunomarujo');
    expect(s).toBe('nunomarujo performed some_future_action on widget');
  });

  it('degrades gracefully when detail is null', () => {
    const s = describeAuditEvent(row({ action: 'catalog_delete', detail: null }), 'nunomarujo');
    expect(s).toBe('nunomarujo deleted a catalog entity');
  });
});
