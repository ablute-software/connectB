// Prompt 918 (Adenda 1, C) — the cover image of a published call, for anyone who has its link. Served by this route; the storage address never leaves the server.
import { publicMedia } from '@/lib/calls/applicant/public-media';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { token: string } }) { return publicMedia(req, params.token, 'cover'); }
