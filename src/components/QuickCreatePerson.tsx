'use client';
// Batch 2 item 3 — /log's "Outra pessoa…" quick-create. Name alone is
// enough; everything else is optional. Created flagged identity_verified:
// false ("identidade não confirmada" pill shows on their profile until
// resolved — see people/[id]/page.tsx) and attached to the entity
// immediately so the interaction can be saved without friction.
import { useState } from 'react';
import { useStore } from '@/lib/store';

export function QuickCreatePerson({ entityId, onCreated, onCancel, initialName, initialEmail }: {
  entityId: string; onCreated: (personId: string) => void; onCancel: () => void;
  // Batch 2 item 3 — route-to "Criar pessoa daqui" pre-fills name/email
  // parsed from an interaction's text; the founder still edits before saving.
  initialName?: string; initialEmail?: string;
}) {
  const { addPerson } = useStore();
  const [fullName, setFullName] = useState(initialName ?? '');
  const [role, setRole] = useState('');
  const [gender, setGender] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [phone, setPhone] = useState('');

  function submit() {
    if (!fullName.trim()) return;
    const person = addPerson({
      entity_id: entityId, full_name: fullName.trim(),
      role: role.trim() || undefined, gender: gender || undefined,
      linkedin_url: linkedinUrl.trim() || undefined, email_guess: email.trim() || undefined, phone: phone.trim() || undefined,
    });
    onCreated(person.id);
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Name (required)" autoFocus
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
      <div className="grid grid-cols-2 gap-1.5">
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role"
          className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <select value={gender} onChange={(e) => setGender(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Gender (optional)</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
        <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="LinkedIn URL"
          className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="rounded border border-gray-300 px-2 py-1 text-xs" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
          className="col-span-2 rounded border border-gray-300 px-2 py-1 text-xs" />
      </div>
      <div className="flex gap-2">
        <button disabled={!fullName.trim()} onClick={submit}
          className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Add person</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
      </div>
      <p className="text-[11px] text-gray-400">Fica marcada como "identidade não confirmada" até seres confirmada por pesquisa ou uso.</p>
    </div>
  );
}
