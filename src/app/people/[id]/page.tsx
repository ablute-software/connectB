'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Card, EntityLink, PersonEmailBlock, PreflightCard, VerBadge } from '@/components/ui';
import { preflight } from '@/lib/rules';
import { ContributionBox } from '@/components/ContributionBox';
import { EnrichmentBadge } from '@/components/EnrichmentBadge';
import { AffiliationsCard } from '@/components/AffiliationsCard';
import { personCompleteness } from '@/lib/completeness';

export default function PersonPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { db, setDoNotContact } = useStore();
  const router = useRouter();
  const person = db.people.find((p) => p.id === id);
  if (!person) return <div className="text-gray-500">Person not found.</div>;
  const completeness = personCompleteness(person);
  const entity = db.entities.find((e) => e.id === person.entity_id);
  const checks = preflight(db, person, null);
  const history = db.interactions.filter((i) => i.person_id === person.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{person.full_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>{person.role}</span>
            {entity && <>· <EntityLink id={entity.id}>{entity.name}</EntityLink></>}
            {person.based_in && <span>· {person.based_in}</span>}
            {person.linkedin_url && !person.do_not_contact && (
              <a href={person.linkedin_url} target="_blank" className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50">
                LinkedIn <VerBadge state={person.linkedin_verified ? 'verified' : 'missing'} label={person.linkedin_verified ? '✓' : '?'} />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/people/${person.id}/prep`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Meeting prep</Link>
          {!person.do_not_contact && (
            <Link href={`/log?entity=${person.entity_id}&person=${person.id}`}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Log interaction</Link>
          )}
        </div>
      </div>

      {!person.do_not_contact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <EnrichmentBadge result={completeness} subjectType="person" subjectId={person.id} orgId={db.org.id} />
        </div>
      )}
      {!person.do_not_contact && <ContributionBox subjectType="person" subjectId={person.id} orgId={db.org.id} />}

      {person.do_not_contact && (
        <div className="rounded-lg border-l-4 border-[#B00000] bg-red-50 px-4 py-3 text-sm text-[#B00000] font-medium">
          DO NOT CONTACT — permanent. Contact fields hidden, research fields purged, outbounds blocked. No override.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          {!person.do_not_contact && (
            <PreflightCard checks={checks}
              onProceed={() => router.push(`/log?entity=${person.entity_id}&person=${person.id}`)}
              ctaLabel="Open log flow" />
          )}
          {person.hook && (
            <Card title="★ Hook — line 1 material" tint="blue">
              <p className="text-sm">{person.hook}</p>
            </Card>
          )}
          {person.kill_words.length > 0 && (
            <Card title="Kill words — never use with this person" tint="red">
              <div className="flex flex-wrap gap-2">
                {person.kill_words.map((k) => (
                  <span key={k} className="rounded bg-red-100 px-2 py-0.5 text-sm font-medium text-red-800">{k}</span>
                ))}
              </div>
            </Card>
          )}
          {person.watch_outs && (
            <Card title="Watch-outs" tint="amber"><p className="text-sm">{person.watch_outs}</p></Card>
          )}
          <Card title="Interaction history">
            {history.length === 0
              ? <p className="text-sm text-gray-400">No interactions yet.{entity?.submission_channel ? ` Official channel first: ${entity.submission_channel}` : ''}</p>
              : (
                <ul className="space-y-2">
                  {history.map((i) => (
                    <li key={i.id} className="rounded border border-gray-100 bg-gray-50 p-2 text-sm">
                      <span className={`mr-2 text-xs font-bold ${i.direction === 'out' ? 'text-[#0E7490]' : 'text-green-700'}`}>
                        {i.direction === 'out' ? '→ OUT' : '← IN'}
                      </span>
                      <span className="text-xs text-gray-500">{i.channel.replace('_', ' ')} · {i.occurred_at.slice(0, 10)}</span>
                      <div className="mt-1 whitespace-pre-wrap text-gray-700">{i.content}</div>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>

        <div className="space-y-4">
          {!person.do_not_contact && (
            <Card title="Contact">
              <PersonEmailBlock person={person} />
              <div className="mt-2 text-sm">
                <div className="text-xs text-gray-500">Phone</div>
                <div className="text-gray-600">{person.phone ?? '—'}</div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Only verified emails are copyable. Compose opens mailto: with BCC {db.org.bcc_email}.</p>
            </Card>
          )}
          {!person.do_not_contact && <AffiliationsCard person={person} />}
          {(person.background || person.linked_funds.length > 0 || person.linked_companies.length > 0) && (
            <Card title="Background">
              {person.background && <p className="text-sm text-gray-600">{person.background}</p>}
              <div className="mt-2 flex flex-wrap gap-1">
                {[...person.linked_funds, ...person.linked_companies].map((x) => (
                  <span key={x} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{x}</span>
                ))}
              </div>
            </Card>
          )}
          {person.personal_notes && (
            <Card title="Personal notes"><p className="text-sm text-gray-600">{person.personal_notes}</p></Card>
          )}
          <Card title="Intro path">
            <p className="text-sm text-gray-600">{person.intro_path ?? '—'}</p>
          </Card>
          <Card title="GDPR">
            <dl className="space-y-1 text-sm text-gray-600">
              <div><span className="text-xs text-gray-500">Data source:</span> {person.data_source ?? '—'}</div>
              <div><span className="text-xs text-gray-500">Privacy notice sent:</span> {person.privacy_notice_sent ? 'yes' : 'no'}</div>
            </dl>
            {!person.do_not_contact && (
              <button
                onClick={() => {
                  if (window.confirm('Hides all contact fields, blocks outbounds permanently and purges research fields. No override. Proceed?')) {
                    setDoNotContact(person.id);
                  }
                }}
                className="mt-3 rounded border border-red-300 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">
                Mark do-not-contact (erasure)
              </button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
