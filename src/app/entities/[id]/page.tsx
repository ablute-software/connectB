'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, FitTag, HardFilterBanner, PersonLink, StatusPill, VerBadge, WaveTag, fmtEur } from '@/components/ui';
import { preflight, preflightSummary } from '@/lib/rules';
import { RelationshipSummaryCard } from '@/components/RelationshipSummaryCard';
import { ThreadDrawer } from '@/components/ThreadDrawer';
import { ContributionBox } from '@/components/ContributionBox';
import { EnrichmentBadge } from '@/components/EnrichmentBadge';
import { entityCompleteness } from '@/lib/completeness';
import { relatedContacts } from '@/lib/relationship';

export default function EntityPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { db, setInterest, setEntityStatus } = useStore();
  const entity = db.entities.find((e) => e.id === id);
  const [interest, setInterestLocal] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!entity) return <div className="text-gray-500">Entity not found.</div>;
  const completeness = entityCompleteness(entity);

  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);
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
        </div>
      </div>

      <HardFilterBanner entity={entity} />
      {locked && (
        <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-4 py-2 text-sm text-cyan-900">
          🔒 Contact lock until {entity.contact_lock_until!.slice(0, 10)} — one approach per entity.
        </div>
      )}

      <RelationshipSummaryCard entity={entity} onOpenThread={() => setDrawerOpen(true)} />

      <Card title="Entity summary" right={<EnrichmentBadge result={completeness} subjectType="entity" subjectId={entity.id} orgId={db.org.id} />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-1.5 text-sm text-gray-600">
            <div className="flex items-center gap-1">Website: {entity.website
              ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://', '')}</a> : '—'}
              {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
            </div>
            <div>Domain: {entity.email_domain ?? '—'} {entity.email_domain_verified && '✓'}</div>
            <div>HQ: {entity.hq_city ? `${entity.hq_city}, ` : ''}{entity.hq_country ?? '—'}</div>
            <div>Geos: {entity.invests_in_geographies.join(', ') || '—'}</div>
            <div>Sectors: {entity.sectors.join(', ') || '—'}</div>
            <div>Stage: {entity.stage_min?.replace('_', ' ') ?? '—'} – {entity.stage_max?.replace('_', ' ') ?? '—'}</div>
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
          <ContributionBox subjectType="entity" subjectId={entity.id} orgId={db.org.id} />
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
                Not part of this entity's contact order — a separate, informational affiliation (§1c).
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
