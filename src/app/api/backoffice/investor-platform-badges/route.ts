// Prompt 703 §4 — investor-firm equivalent of /api/backoffice/platform-badges,
// scoped to grant/revoke only (see investor-platform-badges-server.ts's own
// header for why there's no Stripe coupon application or lapse sweep here).
// Same audit bar as the founder route: every write is gated by
// requirePlatformAdmin() and leaves an admin_audit_log line.
//
//   GET                       every row (active and revoked), with the
//                             catalog entity's name
//   POST { action: 'grant' }  { catalogEntityId, badge, justification }
//   POST { action: 'revoke' } { id, reason }
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { INVESTOR_PLATFORM_BADGE_COLUMNS, toInvestorBadgeRow } from '@/lib/investor-platform-badges-server';
import { BADGE_LABEL, MANUAL_BADGES, type PlatformBadgeKey } from '@/lib/platform-badges';

// Deliberately NOT platform-badges.ts's own rightsText(): its copy ("free
// forever", "X% off any paid plan") describes the founder-side Stripe
// coupon this badge does NOT apply for an investor firm — there is no
// billing effect here today, only the suggestion-eligibility bypass
// (suggestions-gate.ts) and a cohort-recognition mark. Reusing that text
// would promise a discount that never gets applied.
const INVESTOR_BADGE_RIGHTS: Record<PlatformBadgeKey, string> = {
  tech_master: 'Access to Suggest an improvement in Tell us.',
  pioneer: 'Access to Suggest an improvement in Tell us.',
  sedulous: '', dyed_in_the_wool: '', toughness: '',
};

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin.from('investor_platform_badges')
    .select(`${INVESTOR_PLATFORM_BADGE_COLUMNS}, catalog_entities(name)`).order('granted_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const badges = ((data ?? []) as unknown as (Parameters<typeof toInvestorBadgeRow>[0] & { catalog_entities: { name: string } | null })[])
    .map((raw) => {
      const row = toInvestorBadgeRow(raw);
      return {
        id: row.id, catalogEntityId: row.catalogEntityId, entityName: raw.catalog_entities?.name ?? '(unknown firm)',
        badge: row.badge, label: BADGE_LABEL[row.badge], rights: INVESTOR_BADGE_RIGHTS[row.badge],
        grantedAt: row.grantedAt, grantedBy: row.grantedBy, justification: row.justification,
        revokedAt: row.revokedAt, revokeReason: row.revokeReason,
      };
    });
  return NextResponse.json({ ok: true, badges });
}

type Body = {
  action?: 'grant' | 'revoke';
  catalogEntityId?: string; badge?: string; justification?: string;
  id?: string; reason?: string;
};

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as Body;
  const now = new Date();

  if (body.action === 'grant') {
    const badge = body.badge as PlatformBadgeKey;
    if (!body.catalogEntityId) return NextResponse.json({ ok: false, error: 'catalogEntityId is required.' }, { status: 400 });
    if (!MANUAL_BADGES.includes(badge)) {
      return NextResponse.json({ ok: false, error: 'Only tech master and pioneer are granted by hand.' }, { status: 400 });
    }
    const justification = (body.justification ?? '').trim();
    if (justification.length < 8) return NextResponse.json({ ok: false, error: 'A justification is required (why this firm, which cohort).' }, { status: 400 });

    const { data: entity } = await admin.from('catalog_entities').select('id, name').eq('id', body.catalogEntityId).maybeSingle();
    if (!entity) return NextResponse.json({ ok: false, error: 'No investor firm with that id.' }, { status: 404 });
    const { data: existing } = await admin.from('investor_platform_badges').select('id')
      .eq('catalog_entity_id', body.catalogEntityId).eq('badge', badge).is('revoked_at', null).maybeSingle();
    if (existing) return NextResponse.json({ ok: false, error: `${entity.name} already holds ${BADGE_LABEL[badge]}.` }, { status: 409 });

    const { data: inserted, error } = await admin.from('investor_platform_badges').insert({
      catalog_entity_id: body.catalogEntityId, badge, granted_by: userId, justification,
    }).select(INVESTOR_PLATFORM_BADGE_COLUMNS).single();
    if (error || !inserted) return NextResponse.json({ ok: false, error: error?.message ?? 'Insert failed.' }, { status: 500 });

    await logAdminAction(admin, {
      adminUserId: userId, action: 'investor_platform_badge_granted', subjectType: 'investor_entity', subjectId: body.catalogEntityId,
      detail: { badge, entityName: entity.name, justification },
    });
    return NextResponse.json({ ok: true, id: inserted.id });
  }

  if (body.action === 'revoke') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const reason = (body.reason ?? '').trim();
    if (reason.length < 4) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });
    const { data: raw } = await admin.from('investor_platform_badges')
      .select(`${INVESTOR_PLATFORM_BADGE_COLUMNS}, catalog_entities(name)`).eq('id', body.id).maybeSingle();
    if (!raw) return NextResponse.json({ ok: false, error: 'No such badge row.' }, { status: 404 });
    if (raw.revoked_at) return NextResponse.json({ ok: false, error: 'Already revoked.' }, { status: 409 });
    const entityInfo = raw.catalog_entities as unknown as { name: string } | null;

    const { error } = await admin.from('investor_platform_badges')
      .update({ revoked_at: now.toISOString(), revoked_by: userId, revoke_reason: reason }).eq('id', body.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    await logAdminAction(admin, {
      adminUserId: userId, action: 'investor_platform_badge_revoked', subjectType: 'investor_entity', subjectId: raw.catalog_entity_id as string,
      detail: { badge: raw.badge, entityName: entityInfo?.name ?? null, reason },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'action must be grant or revoke.' }, { status: 400 });
}
