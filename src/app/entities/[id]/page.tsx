'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, FitTag, HardFilterBanner, PersonLink, StatusPill, VerBadge, WaveTag, fmtEur } from '@/components/ui';
import { preflight, preflightSummary } from '@/lib/rules';
import { RelationshipSummaryCard } from '@/components/RelationshipSummaryCard';
import { ThreadDrawer } from '@/components/ThreadDrawer';
import { ContributionBox } from '@/components/ContributionBox';
import { EnrichmentBadge } from '@/components/EnrichmentBadge';
import { entityCompleteness } from '@/lib/completeness';
import { isPersonCandidate, relatedContacts } from '@/lib/relationship';
import { computeAlignment } from '@/lib/company-canon-logic';
import { browserClient } from '@/lib/supabase';
import { EntityClassificationEditor } from '@/components/EntityClassificationEditor';

export default function EntityPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { db, setInterest, setEntityStatus, convertEntityToPerson, markEntityVerified, updateEntity } = useStore();
  const entity = db.entities.find((e) => e.id === id);
  const [interest, setInterestLocal] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [contactAvailable, setContactAvailable] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({ website: '', email: '', phone: '', address: '' });
  const [contributionsRefreshKey, setContributionsRefreshKey] = useState(0);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setContactAvailable(!!me.capabilities?.entityContactFields)).catch(() => {});
  }, []);

  if (!entity) return <div className="text-gray-500">Entity not found.</div>;

  function startEditContact() {
    setContactDraft({
      website: entity!.website ?? '', email: entity!.email ?? '',
      phone: entity!.phone ?? '', address: entity!.address ?? '',
    });
    setEditingContact(true);
  }

  function saveContact() {
    updateEntity(entity!.id, {
      website: contactDraft.website.trim() || undefined,
      email: contactDraft.email.trim() || undefined,
      phone: contactDraft.phone.trim() || undefined,
      address: contactDraft.address.trim() || undefined,
    });
    setEditingContact(false);
  }
  const completeness = entityCompleteness(entity);

  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const personCandidate = isPersonCandidate(db, entity);
  // §11d — only computed/shown once there's real canon to compare against;
  // stays invisible tonight (db.companyFacts is empty pre-migration/pre-population).
  const alignment = db.companyFacts.length > 0 ? computeAlignment(entity, db.companyFacts) : null;
  const alsoConnected = relatedContacts(db, entity.id).filter((r) => r.viaAffiliation);
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > new Date();
  const grants = db.grants.filter((g) => people.some((p) => p.id === g.person_id));
  const views = db.views.filter((v) => grants.some((g) => g.id === v.grant_id)
    || people.some((p) => p.email_verified && p.email_verified === v.viewer_email));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{entity.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <StatusPill status={entity.status} /> <FitTag fit={entity.fit_score} /> <WaveTag wave={entity.wave} />
            <span>{entity.type.replace('_', ' ')}</span>
            <span>· {entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/log?entity=${entity.id}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Log interaction</Link>
          {entity.status !== 'dormant' && (
            <button onClick={() => setEntityStatus(entity.id, 'dormant', 'Manually parked')}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Mark dormant</button>
          )}
          {confirmConvert ? (
            <div className="flex items-center gap-1 rounded-lg border border-purple-300 bg-purple-50 px-2 py-1">
              <span className="text-xs text-purple-800">Convert to a person?</span>
              <button onClick={() => { convertEntityToPerson(entity.id); setConfirmConvert(false); }}
                className="rounded bg-purple-700 px-2 py-1 text-xs font-medium text-white hover:bg-purple-800">Confirm</button>
              <button onClick={() => setConfirmConvert(false)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmConvert(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">Convert to person (angel)</button>
          )}
        </div>
      </div>

      {personCandidate && (
        <div className="flex items-start justify-between gap-4 rounded-lg border-l-4 border-purple-400 bg-purple-50 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-purple-900">This looks like a person, not a fund</div>
            <div className="text-sm text-gray-700">
              No website, no email domain, and no contacts recorded under it — likely an individual (e.g. a solo angel) imported as an organization.
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => convertEntityToPerson(entity.id)}
              className="rounded bg-purple-700 px-2 py-1 text-xs font-medium text-white hover:bg-purple-800">Convert to person (angel)</button>
            <button onClick={() => markEntityVerified(entity.id)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Not a person</button>
          </div>
        </div>
      )}

      <HardFilterBanner entity={entity} />
      {alignment && alignment.status !== 'aligned' && (
        <div className={`rounded-lg border-l-4 px-4 py-3 ${alignment.status === 'misaligned' ? 'border-[#B00000] bg-red-50' : 'border-amber-400 bg-amber-50'}`}>
          <div className={`text-sm font-semibold ${alignment.status === 'misaligned' ? 'text-[#B00000]' : 'text-amber-900'}`}>
            {alignment.status === 'misaligned' ? '⚠ Misaligned with the current company canon' : 'Caution — check against the company canon'}
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {alignment.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {alignment.status === 'misaligned' && (
            <p className="mt-1 text-xs text-gray-500">Consider parking this one with a reopen trigger rather than approaching now.</p>
          )}
        </div>
      )}
      {locked && (
        <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-4 py-2 text-sm text-cyan-900">
          🔒 Contact lock until {entity.contact_lock_until!.slice(0, 10)} — one approach per entity.
        </div>
      )}

      <RelationshipSummaryCard entity={entity} onOpenThread={() => setDrawerOpen(true)} />

      {db.ndas.filter((n) => n.entity_id === entity.id).length > 0 && (
        <Card title="NDAs on file">
          <ul className="space-y-2 text-sm">
            {db.ndas.filter((n) => n.entity_id === entity.id).map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2">
                <span>{n.file_name ?? 'NDA'}</span>
                <span className="text-xs text-gray-400">
                  uploaded {n.uploaded_at.slice(0, 10)}{n.uploaded_by ? ` by ${n.uploaded_by}` : ''}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  n.match_status === 'match' ? 'bg-green-100 text-green-800'
                  : n.match_status === 'mismatch' ? 'bg-red-100 text-[#B00000]'
                  : 'bg-amber-100 text-amber-800'}`} title={n.match_notes}>
                  {n.match_status === 'match' ? 'AI check: match' : n.match_status === 'mismatch' ? 'AI check: correspondência incerta — verificar' : 'AI check: uncertain'}
                </span>
                <button
                  onClick={async () => {
                    const sb = browserClient();
                    const { data, error } = await sb.storage.from('data-room').createSignedUrl(n.storage_path, 60);
                    if (error) { alert(`Could not open file: ${error.message}`); return; }
                    window.open(data.signedUrl, '_blank');
                  }}
                  className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                  Open
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Entity summary" right={<EnrichmentBadge result={completeness} subjectType="entity" subjectId={entity.id} orgId={db.org.id} onEnriched={() => setContributionsRefreshKey((k) => k + 1)} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-1.5 text-sm text-gray-600">
            {contactAvailable ? (
              <div className="-mx-2 mb-1 rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">Contact</span>
                  {!editingContact && <button onClick={startEditContact} className="text-xs text-cyan-700 hover:underline">Edit</button>}
                </div>
                {editingContact ? (
                  <div className="space-y-1.5">
                    <input value={contactDraft.website} onChange={(e) => setContactDraft({ ...contactDraft, website: e.target.value })}
                      placeholder="Website" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                      placeholder="Email" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })}
                      placeholder="Phone" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <input value={contactDraft.address} onChange={(e) => setContactDraft({ ...contactDraft, address: e.target.value })}
                      placeholder="Address" className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                    <div className="flex gap-2">
                      <button onClick={saveContact} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Save</button>
                      <button onClick={() => setEditingContact(false)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-1">Website: {entity.website
                      ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://', '')}</a> : '—'}
                      {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
                    </div>
                    <div>Email: {entity.email ?? '—'}</div>
                    <div>Phone: {entity.phone ?? '—'}</div>
                    <div>Address: {entity.address ?? '—'}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">Website: {entity.website
                ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://', '')}</a> : '—'}
                {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
              </div>
            )}
            <div>Domain: {entity.email_domain ?? '—'} {entity.email_domain_verified && '✓'}</div>
            <div>HQ: {entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country ?? '—'}</div>
            <EntityClassificationEditor entity={entity} onUpdate={(patch) => updateEntity(entity.id, patch)} />
            <div>Check: {fmtEur(entity.check_min_eur)}–{fmtEur(entity.check_max_eur)}</div>
          </dl>
          <div className="space-y-3">
            {entity.thesis && (
              <div>
                <div className="text-xs text-gray-500">Thesis — their own words</div>
                <p className="text-sm italic text-gray-600">“{entity.thesis}”</p>
              </div>
            )}
            {entity.network_cluster_notes && (
              <div>
                <div className="text-xs text-gray-500">Network notes</div>
                <p className="text-sm text-gray-700">{entity.network_cluster_notes}</p>
              </div>
            )}
            {!entity.thesis && !entity.network_cluster_notes && <p className="text-sm text-gray-400">No thesis or network notes yet.</p>}
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3">
          <ContributionBox subjectType="entity" subjectId={entity.id} orgId={db.org.id} subject={entity as unknown as Record<string, unknown>}
            onApplyValue={(field, value) => updateEntity(entity.id, { [field]: value } as Partial<typeof entity>)} refreshKey={contributionsRefreshKey} />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card title="People (contact order enforced)">
            <ul className="divide-y divide-gray-100">
              {people.map((p) => {
                const s = preflightSummary(preflight(db, p, null));
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{p.seniority_rank}</span>
                    <div className="min-w-0 flex-1">
                      <PersonLink id={p.id}><span className="font-medium">{p.full_name}</span></PersonLink>
                      <span className="ml-2 text-xs text-gray-500">{p.role}</span>
                      {p.do_not_contact && <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] font-bold text-red-700">DO NOT CONTACT</span>}
                      <div className="mt-0.5 flex gap-3">
                        <VerBadge state={p.linkedin_verified ? 'verified' : 'missing'} label={p.linkedin_verified ? 'LinkedIn ✓' : 'LinkedIn ?'} />
                        <VerBadge state={p.bounce_count > 0 ? 'bounced' : p.email_verified ? 'verified' : p.email_guess ? 'guessed' : 'missing'}
                          label={p.bounce_count > 0 ? `Email bounced ×${p.bounce_count}` : p.email_verified ? 'Email ✓' : p.email_guess ? 'Email guessed' : 'No email'} />
                        {p.hook_status !== 'researched' && <span className="text-xs text-gray-400">no researched hook</span>}
                      </div>
                    </div>
                    <span title={s.green ? 'Pre-flight green' : 'Pre-flight failing'} className={s.green ? 'text-green-600' : 'text-[#B00000]'}>●</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-gray-400">Rank 2 unlocks only after rank 1 replies or goes dormant.</p>
          </Card>

          {alsoConnected.length > 0 && (
            <Card title="Also connected (other affiliations)" tint="amber">
              <ul className="space-y-1.5 text-sm">
                {alsoConnected.map((r) => (
                  <li key={r.person.id}>
                    <PersonLink id={r.person.id}>{r.person.full_name}</PersonLink>
                    {r.entity && <span className="text-gray-500"> — primarily at {r.entity.name}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400">
                Not part of this entity's contact order — a separate, informational affiliation.
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Approach" tint="blue">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-gray-500">Our angle</dt><dd>{entity.our_angle ?? '—'}</dd></div>
              <div><dt className="text-xs text-gray-500">The ask (one, small)</dt><dd className="font-medium">{entity.the_ask ?? '—'}</dd></div>
              {entity.submission_channel && (
                <div><dt className="text-xs text-gray-500">Official channel — use first</dt>
                  <dd className="font-mono text-xs">{entity.submission_channel}</dd></div>
              )}
            </dl>
          </Card>
          <Card title="Round">
            <div className="text-sm">
              <div className="text-xs text-gray-500">Soft-circled / committed</div>
              <div className="mt-1 flex gap-2">
                <input value={interest || (entity.interest_eur ?? '')} onChange={(e) => setInterestLocal(e.target.value)}
                  placeholder="e.g. 250000" className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                <button onClick={() => setInterest(entity.id, interest ? Number(interest) : undefined)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Save</button>
              </div>
              <div className="mt-1 text-xs text-gray-400">Current: {fmtEur(entity.interest_eur)}</div>
            </div>
          </Card>
          {(grants.length > 0 || views.length > 0) && (
            <Card title="Data room engagement">
              <div className="text-sm text-gray-600">
                {grants.filter((g) => !g.revoked_at).length} active grant(s) · {views.length} view(s)
              </div>
              {views.slice(-3).reverse().map((v) => (
                <div key={v.id} className="mt-1 text-xs text-gray-500">
                  {db.documents.find((d) => d.id === v.document_id)?.name} — {v.viewed_at.slice(0, 16).replace('T', ' ')}
                  {v.seconds ? ` · ${Math.round(v.seconds / 60)} min` : ''}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <ThreadDrawer entity={entity} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
