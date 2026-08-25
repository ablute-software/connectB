// Real interaction-history import (ablute_historico_fundos.md) — parses
// the uploaded .md deterministically (no AI needed for structure; only
// person-mention proposals use one, in extract-people). Reuses the
// existing import_batches/Storage flow — the file itself never leaves
// Storage (org-private bucket) and never enters the repo.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { parseMdHistory, mergeAliasedSections } from '@/lib/md-history-import';
import { assertNotViewer } from '@/lib/developer-viewer';
import { detectAllowedKind, scanWithVirusTotal } from '@/lib/upload-security';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { batchId } = await req.json();
  if (!batchId) return NextResponse.json({ ok: false, error: 'batchId required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: batch, error: batchErr } = await admin.from('import_batches').select('*').eq('id', batchId).single();
  if (batchErr || !batch) return NextResponse.json({ ok: false, error: batchErr?.message ?? 'batch not found' }, { status: 404 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', batch.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  if (!batch.file_name.toLowerCase().endsWith('.md')) {
    return NextResponse.json({ ok: false, error: 'Expected a .md file for the structured history importer.' }, { status: 400 });
  }

  await admin.from('import_batches').update({ status: 'extracting' }).eq('id', batchId);
  try {
    const { data: fileBlob, error: dlErr } = await admin.storage.from('data-room').download(batch.storage_path);
    if (dlErr || !fileBlob) throw new Error(dlErr?.message ?? 'download failed');
    const bytes = Buffer.from(await fileBlob.arrayBuffer());

    // Prompt 305 §A (adversarial-review follow-up) — the browser uploads
    // straight to Storage before this route runs (same gap the Vault's
    // main path had before Prompt 301); validate the real bytes here,
    // before they're ever parsed. Known, accepted scope limit (documented,
    // not silent): import_batches is a transient staging row the founder
    // reviews and either commits or discards — no persisted scan-status
    // tracking/cron sweep for it, since nothing here ever serves this file
    // to anyone but the uploading founder automatically.
    if (!detectAllowedKind(bytes, batch.file_name as string)) {
      await admin.storage.from('data-room').remove([batch.storage_path as string]);
      throw new Error('This file\'s content doesn\'t match a Markdown/text file, or its extension isn\'t allowed.');
    }
    const verdict = await scanWithVirusTotal(bytes);
    if (verdict.status === 'flagged') {
      await admin.storage.from('data-room').remove([batch.storage_path as string]);
      throw new Error(`Upload blocked — ${verdict.detail}`);
    }
    const text = bytes.toString('utf-8');

    const sections = mergeAliasedSections(parseMdHistory(text));
    const extraction = { kind: 'md-history', sections };

    await admin.from('import_batches').update({ status: 'staged', extraction }).eq('id', batchId);
    return NextResponse.json({
      ok: true, sectionCount: sections.length,
      interactionCount: sections.reduce((s, x) => s + x.interactions.length, 0),
    });
  } catch (e) {
    await admin.from('import_batches').update({ status: 'failed', error: (e as Error).message }).eq('id', batchId);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
