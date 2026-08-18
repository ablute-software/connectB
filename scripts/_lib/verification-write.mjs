// Prompt 250 Camada 2 — shared helper for ad-hoc verification scripts
// (scripts/_verify_*.mjs, _check_*.mjs, _debug_*.mjs, …) that need to write
// through a REAL Supabase connection (e.g. testing an actual RLS policy or
// route behaviour that demo mode can't exercise).
//
// Import these functions INSTEAD OF calling admin.from('interactions')
// .insert(...) / admin.from('deal_messages').insert(...) / etc. directly.
// Each one calls a dedicated SECURITY DEFINER Postgres function (migration
// 0183) that checks the target is a `zz-test-*`/is_test fixture and
// performs the write in the SAME function body — atomic, no session state
// assumed across separate PostgREST calls (which is why this is NOT a
// `SET LOCAL` + plain insert: that was tried first and doesn't work
// reliably over supabase-js, see 0183's own header for the full reasoning).
//
// A write against a real record throws with a clear message instead of
// silently succeeding — that's the whole point.
//
// New verification fixtures (orgs, entities, catalog_entities) MUST be
// named starting with `zz-test-` (case-insensitive) to be accepted here.

const TEST_NAME_PATTERN = /^zz-test-/i;

export function isTestFixtureName(name) {
  return typeof name === 'string' && TEST_NAME_PATTERN.test(name);
}

// Fails fast client-side with the SAME message shape the DB would give,
// before even making the round-trip — useful when a script is about to
// CREATE a fixture and should catch a typo in the name immediately.
export function assertTestFixtureName(name, context) {
  if (!isTestFixtureName(name)) {
    throw new Error(`verification-write: "${name}"${context ? ` (${context})` : ''} does not start with "zz-test-" — refusing to treat it as a disposable fixture.`);
  }
}

export async function verificationInsertInteraction(admin, params) {
  const { data, error } = await admin.rpc('verification_insert_interaction', {
    p_org_id: params.orgId, p_entity_id: params.entityId, p_direction: params.direction,
    p_channel: params.channel, p_content: params.content, p_person_id: params.personId ?? null,
    p_classification: params.classification ?? null, p_pass_reason_category: params.passReasonCategory ?? null,
    p_pass_reason: params.passReason ?? null, p_occurred_at: params.occurredAt ?? new Date().toISOString(),
  });
  if (error) throw new Error(`verification_insert_interaction: ${error.message}`);
  return data;
}

export async function verificationGetOrCreateDealThread(admin, startupOrgId, investorCatalogEntityId) {
  const { data, error } = await admin.rpc('verification_get_or_create_deal_thread', {
    p_startup_org_id: startupOrgId, p_investor_catalog_entity_id: investorCatalogEntityId,
  });
  if (error) throw new Error(`verification_get_or_create_deal_thread: ${error.message}`);
  return data;
}

export async function verificationInsertDealMessage(admin, params) {
  const { data, error } = await admin.rpc('verification_insert_deal_message', {
    p_thread_id: params.threadId, p_sender_side: params.senderSide, p_sender_user_id: params.senderUserId,
    p_body: params.body, p_links: params.links ?? [], p_document_ids: params.documentIds ?? [],
  });
  if (error) throw new Error(`verification_insert_deal_message: ${error.message}`);
  return data;
}

export async function verificationInsertCatalogDelivery(admin, params) {
  const { data, error } = await admin.rpc('verification_insert_catalog_delivery', {
    p_org_id: params.orgId, p_catalog_id: params.catalogId,
    p_entity_id: params.entityId ?? null, p_via_pack: params.viaPack ?? null,
  });
  if (error) throw new Error(`verification_insert_catalog_delivery: ${error.message}`);
  return data;
}
