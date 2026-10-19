// Prompt 918 (Adenda 1, C) — the logo uploaded for a published call (when it has none of its own, the page uses the entity's profile logo, which is an address of its own).
import { publicMedia } from '@/lib/calls/applicant/public-media';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) { return publicMedia(params.token, 'logo'); }
