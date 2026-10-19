// Prompt 918 (Adenda 1, C) — the cover image of a published call, for anyone who has its link: a short-lived signed address of the stored image, never its storage path.
import { publicMedia } from '@/lib/calls/applicant/public-media';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) { return publicMedia(params.token, 'cover'); }
