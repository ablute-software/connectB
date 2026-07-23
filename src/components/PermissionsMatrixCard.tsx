'use client';
// Batch 3 C — owner-only role→capability matrix config. A table where the
// owner toggles which roles hold each capability. The owner column is fixed
// (always all rights, not editable — no lockout possible). Defaults mirror
// today's behaviour. Saving stores overrides; server routes enforce the
// resolved matrix. Hidden unless the caller is the owner AND the
// permissionMatrix migration (0026) is applied.
import { useEffect, useState } from 'react';
import { Card, Tooltip } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from '@/lib/permissions';
import { MATRIX_CAPABILITIES, resolveMatrix, type MatrixCapability } from '@/lib/org-permissions';

export function PermissionsMatrixCard() {
  const [visible, setVisible] = useState(false);
  const [matrix, setMatrix] = useState<Record<MatrixCapability, OrgRole[]> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      const ok = me.orgRole === 'owner' && !!me.capabilities?.permissionMatrix;
      setVisible(ok);
      if (ok) {
        fetch('/api/org/permissions').then((r) => r.json()).then((b) => {
          if (b.ok) setMatrix(b.resolved as Record<MatrixCapability, OrgRole[]>);
        });
      }
    }).catch(() => {});
  }, []);

  if (!visible) return null;

  function toggle(cap: MatrixCapability, role: OrgRole) {
    if (role === 'owner' || !matrix) return; // owner column fixed
    const has = matrix[cap].includes(role);
    const next = has ? matrix[cap].filter((r) => r !== role) : [...matrix[cap], role];
    setMatrix({ ...matrix, [cap]: next });
    setSaved(false);
  }

  async function save() {
    if (!matrix) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/org/permissions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overrides: matrix }),
      });
      const b = await res.json();
      if (!b.ok) { setErr(b.error ?? 'Failed'); return; }
      setMatrix(resolveMatrix(b.resolved ?? matrix));
      setSaved(true);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Card title="Permissions">
      <p className="mb-2 text-xs text-gray-500">
        Configure what each role can do. The <b>owner</b> always keeps every right (fixed). Changes are enforced
        server-side, not just in the interface.
      </p>
      {!matrix ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-2 font-medium">Capability</th>
                {ORG_ROLES.map((r) => <th key={r} className="px-2 py-1 text-center font-medium">{ROLE_LABELS[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX_CAPABILITIES.map((c) => (
                <tr key={c.key} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2">
                    {c.note ? <Tooltip text={c.note}><span className="border-b border-dotted border-gray-300">{c.label}</span></Tooltip> : c.label}
                  </td>
                  {ORG_ROLES.map((r) => (
                    <td key={r} className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={matrix[c.key].includes(r)} disabled={r === 'owner'}
                        onChange={() => toggle(c.key, r)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-2">
            <button disabled={saving} onClick={save} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save permissions'}
            </button>
            {saved && <span className="text-xs text-green-700">Saved.</span>}
            {err && <span className="text-xs text-[#B00000]">{err}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
