'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, FitTag, HardFilterBanner, PersonLink, StatusPill, VerBadge, WaveTag, fmtEur } from '@/components/ui';
import { preflight, preflightSummary } from '@/lib/rules';

export default function EntityPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { db, setInterest, setEntityStatus } = useStore();
  const entity = db.entities.find((e) => e.id === id);
  const [interest, setInterestLocal] = useState<string>('');

  if (!entity) return <div className="text-gray-500">Entity not found.</div>;

  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const timeline = db.interactions.filter((i) => i.entity_id === entity.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
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

          <Card title="Interaction timeline">
            {timeline.length === 0
              ? <p className="text-sm text-gray-400">No interactions yet.{entity.submission_channel ? ` Official channel first: ${entity.submission_channel}` : ''}</p>
              : (
                <ul className="space-y-3">
                  {timeline.map((i) => (
                    <li key={i.id} className="rounded border border-gray-100 bg-gray-50 p-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className={i.direction === 'out' ? 'font-bold text-[#0E7490]' : 'font-bold text-green-700'}>
                          {i.direction === 'out' ? '→ OUT' : '← IN'}
                        </span>
                        <span className="rounded bg-white px-1.5 py-0.5 border border-gray-200">{i.channel.replace('_', ' ')}</span>
                        <span>{i.occurred_at.slice(0, 10)}</span>
                        {i.person_id && <PersonLink id={i.person_id}>{db.people.find((p) => p.id === i.person_id)?.full_name}</PersonLink>}
                        {i.classification && <span className="rounded bg-gray-200 px-1.5 py-0.5">{i.classification.replace('_', ' ')}</span>}
                        {i.automation_run_id && <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-cyan-800">automation</span>}
                      </div>
                      <blockquote className="whitespace-pre-wrap border-l-2 border-gray-300 pl-2 text-gray-700">{i.content}</blockquote>
                      {i.pass_reason && <div className="mt-1 text-xs text-[#B00000]">Pass reason ({i.pass_reason_category}): {i.pass_reason}</div>}
                      {i.next_action && <div className="mt-1 text-xs text-gray-500">Next: {i.next_action} {i.next_action_due && `· ${i.next_action_due}`}</div>}
                    </li>
                  ))}
                </ul>
              )}
          </Card>
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
          {entity.thesis && <Card title="Thesis — their own words"><p className="text-sm italic text-gray-600">“{entity.thesis}”</p></Card>}
          {entity.network_cluster_notes && <Card title="Network notes" tint="amber"><p className="text-sm">{entity.network_cluster_notes}</p></Card>}
          <Card title="Details">
            <dl className="space-y-1 text-sm text-gray-600">
              <div>Stage: {entity.stage_min?.replace('_',' ')} – {entity.stage_max?.replace('_',' ')}</div>
              <div>Check: {fmtEur(entity.check_min_eur)}–{fmtEur(entity.check_max_eur)}</div>
              <div>Geos: {entity.invests_in_geographies.join(', ') || '—'}</div>
              <div className="flex items-center gap-1">Website: {entity.website
                ? <a className="text-[#0E7490] hover:underline" href={entity.website} target="_blank">{entity.website.replace('https://','')}</a> : '—'}
                {entity.website && <VerBadge state={entity.website_verified ? 'verified' : 'missing'} label={entity.website_verified ? '' : 'unverified'} />}
              </div>
              <div>Domain: {entity.email_domain ?? '—'} {entity.email_domain_verified && '✓'}</div>
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
    </div>
  );
}
