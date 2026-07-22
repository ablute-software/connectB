'use client';
// IRM_SPEC §1c — multi-affiliation people. Additive to the primary entity_id
// (which still drives contact order / seniority in rules.ts, untouched):
// this surfaces the *other* funds/angel activity a person has.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';
import type { AffiliationKind, Person } from '@/lib/types';

const KINDS: AffiliationKind[] = ['partner', 'principal', 'associate', 'operator', 'angel', 'advisor', 'board_member', 'other'];

export function AffiliationsCard({ person }: { person: Person }) {
  const { db, addAffiliation, endAffiliation } = useStore();
  const [entityId, setEntityId] = useState('');
  const [independent, setIndependent] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<AffiliationKind>('advisor');

  const affiliations = db.personAffiliations.filter((a) => a.person_id === person.id);

  return (
    <Card title="Other affiliations">
      {affiliations.length === 0 ? (
        <p className="text-sm text-gray-400">None recorded beyond {db.entities.find((e) => e.id === person.entity_id)?.name ?? 'their primary entity'}.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {affiliations.map((a) => {
            const e = a.entity_id ? db.entities.find((x) => x.id === a.entity_id) : undefined;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${a.current ? 'bg-[#E8F4F8] text-cyan-900' : 'bg-gray-100 text-gray-400'}`}>
                  {a.kind.replace('_', ' ')}
                </span>
                <span>
                  {a.title ? `${a.title} — ` : ''}
                  {e ? <EntityLink id={e.id}>{e.name}</EntityLink> : <span className="italic text-gray-500">Independent</span>}
                </span>
                {!a.current && <span className="text-xs text-gray-400">(ended {a.ended_at})</span>}
                {a.current && (
                  <button onClick={() => endAffiliation(a.id)} className="ml-auto text-xs text-gray-400 hover:text-[#B00000]">end</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as AffiliationKind)}
            className="rounded border border-gray-300 px-2 py-1 text-xs">
            {KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={independent} onChange={(e) => { setIndependent(e.target.checked); setEntityId(''); }} />
            Independent (no entity)
          </label>
          {!independent && (
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-xs">
              <option value="">Entity…</option>
              {db.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)"
            className="rounded border border-gray-300 px-2 py-1 text-xs" />
        </div>
        <button
          disabled={!independent && !entityId}
          onClick={() => {
            addAffiliation({ person_id: person.id, entity_id: independent ? undefined : entityId, title: title || undefined, kind });
            setEntityId(''); setTitle(''); setIndependent(false); setKind('advisor');
          }}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          + Add affiliation
        </button>
      </div>
    </Card>
  );
}
