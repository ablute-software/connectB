// Generates supabase/seed.sql from the canonical demo seed (src/lib/data/seed.ts).
// Deterministic UUIDs are derived from the readable string ids (uuid v5-like via sha1).
// Run: node scripts/gen-seed-sql.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Compile the TS seed to JSON via a tiny tsx-less trick: strip types with a regex-free approach
// is fragile — instead we transpile with the TypeScript compiler bundled in node_modules.
execSync('npx tsc src/lib/data/seed.ts src/lib/types.ts --module commonjs --target es2020 --moduleResolution node --outDir .seed-build --skipLibCheck', { stdio: 'inherit' });
const { seed } = await import(new URL('../.seed-build/data/seed.js', import.meta.url));

function uuid(id) {
  const h = createHash('sha1').update(`ablute-crm:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const q = (v) => v == null ? 'null'
  : Array.isArray(v) ? `'{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}'`
  : typeof v === 'boolean' || typeof v === 'number' ? String(v)
  : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  : `'${String(v).replace(/'/g, "''")}'`;

const L = [];
L.push('-- Generated from src/lib/data/seed.ts — do not edit by hand. Run: node scripts/gen-seed-sql.mjs');
const ORG = uuid(seed.org.id);
L.push(`insert into orgs (id, name, plan, daily_cap, weekly_cap, sender_email, bcc_email) values (${q(ORG)}, ${q(seed.org.name)}, ${q(seed.org.plan)}, ${seed.org.daily_cap}, ${seed.org.weekly_cap}, ${q(seed.org.sender_email)}, ${q(seed.org.bcc_email)});`);
L.push(`-- After creating your auth user, link it: insert into org_members (org_id, user_id, role) values (${q(ORG)}, '<your-user-uuid>', 'owner');`);

for (const e of seed.entities) {
  L.push(`insert into entities (id, org_id, name, type, hq_city, hq_country, invests_in_geographies, website, website_verified, email_domain, email_domain_verified, stage_min, stage_max, check_min_eur, check_max_eur, sectors, thesis, fit_score, wave, our_angle, the_ask, submission_channel, submission_channel_type, hard_filter, hard_filter_status, network_cluster_notes, interest_eur, contact_lock_until, status, dormant_since, dormant_reason) values (` +
    [uuid(e.id), ORG, e.name, e.type, e.hq_city, e.hq_country, e.invests_in_geographies, e.website, e.website_verified, e.email_domain, e.email_domain_verified, e.stage_min, e.stage_max, e.check_min_eur, e.check_max_eur, e.sectors, e.thesis, e.fit_score, e.wave, e.our_angle, e.the_ask, e.submission_channel, e.submission_channel_type, e.hard_filter, e.hard_filter_status, e.network_cluster_notes, e.interest_eur, e.contact_lock_until, e.status, e.dormant_since, e.dormant_reason]
      .map((v, i) => i === 0 || i === 1 ? q(v) : q(v)).join(', ') + ');');
}
for (const p of seed.people) {
  L.push(`insert into people (id, org_id, entity_id, full_name, role, seniority_rank, based_in, linkedin_url, linkedin_verified, email_verified, email_guess, email_guess_confidence, email_source, bounce_count, phone, background, personal_notes, linked_companies, linked_funds, hook, hook_status, kill_words, watch_outs, preferred_language, intro_path, data_source, privacy_notice_sent, do_not_contact) values (` +
    [uuid(p.id), ORG, uuid(p.entity_id), p.full_name, p.role, p.seniority_rank, p.based_in, p.linkedin_url, p.linkedin_verified, p.email_verified, p.email_guess, p.email_guess_confidence, p.email_source, p.bounce_count, p.phone, p.background, p.personal_notes, p.linked_companies, p.linked_funds, p.hook, p.hook_status, p.kill_words, p.watch_outs, p.preferred_language, p.intro_path, p.data_source, p.privacy_notice_sent, p.do_not_contact]
      .map(q).join(', ') + ');');
}
for (const f of seed.folders) {
  L.push(`insert into folders (id, org_id, name, parent_id, kind, position) values (${q(uuid(f.id))}, ${q(ORG)}, ${q(f.name)}, ${f.parent_id ? q(uuid(f.parent_id)) : 'null'}, ${q(f.kind)}, ${f.position});`);
}
for (const d of seed.documents) {
  L.push(`insert into documents (id, org_id, folder_id, name, version, external_url, is_view_only, visibility, watermark, downloadable, notes) values (${q(uuid(d.id))}, ${q(ORG)}, ${d.folder_id ? q(uuid(d.folder_id)) : 'null'}, ${q(d.name)}, ${q(d.version)}, ${q(d.external_url)}, ${d.is_view_only}, ${q(d.visibility)}, ${d.watermark}, ${d.downloadable}, ${q(d.notes)});`);
}
for (const t of seed.templates) {
  L.push(`insert into message_templates (id, org_id, name, channel, language, body) values (${q(uuid(t.id))}, ${q(ORG)}, ${q(t.name)}, ${q(t.channel)}, ${q(t.language)}, ${q(t.body)});`);
}
for (const a of seed.automations) {
  L.push(`insert into automations (id, org_id, name, trigger, action, mode, channel, template_id, enabled, config) values (${q(uuid(a.id))}, ${q(ORG)}, ${q(a.name)}, ${q(a.trigger)}, ${q(a.action)}, ${q(a.mode)}, ${q(a.channel)}, ${a.template_id ? q(uuid(a.template_id)) : 'null'}, ${a.enabled}, ${q(a.config)});`);
}
for (const t of seed.tasks) {
  L.push(`insert into tasks (id, org_id, title, due_at, entity_id, person_id, kind, done) values (${q(uuid(t.id))}, ${q(ORG)}, ${q(t.title)}, ${q(t.due_at)}, ${t.entity_id ? q(uuid(t.entity_id)) : 'null'}, ${t.person_id ? q(uuid(t.person_id)) : 'null'}, ${q(t.kind)}, ${t.done});`);
}
for (const i of seed.interactions) {
  L.push(`insert into interactions (id, org_id, entity_id, person_id, occurred_at, direction, channel, content, classification, next_action, next_action_due) values (${q(uuid(i.id))}, ${q(ORG)}, ${q(uuid(i.entity_id))}, ${i.person_id ? q(uuid(i.person_id)) : 'null'}, ${q(i.occurred_at)}, ${q(i.direction)}, ${q(i.channel)}, ${q(i.content)}, ${q(i.classification)}, ${q(i.next_action)}, ${q(i.next_action_due)});`);
}

writeFileSync(new URL('../supabase/seed.sql', import.meta.url), L.join('\n') + '\n');
console.log(`Wrote supabase/seed.sql (${L.length} statements).`);
