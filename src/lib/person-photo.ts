// The picture of a founder or team member is a LINK the founder pastes ("Photo URL"). What people paste is rarely the picture: it is the page that SHOWS the
// picture. Confirmed on production, 20/10/2026 (Mob2is, seen in the Developer Viewer as "a photo that does not open"): the stored value was
//   https://drive.google.com/file/d/<id>/view?usp=sharing
// which answers `text/html` — an <img> cannot draw it, so a broken-image box showed in the team card, in the MatchDeal deck and in the investor's dossier —
// while the file itself was public and `https://lh3.googleusercontent.com/d/<id>=w256` answered `image/jpeg`. Two repairs, both here and both pure:
//  · normalizePersonPhotoUrl turns the share links people actually paste (Google Drive, Dropbox) into the address of the image itself — applied on
//    save, and again when a stored link is drawn, so links saved before this need no migration;
//  · personPhotoProblem says, in a founder's words, when a link can never be a picture (a LinkedIn profile, a Drive folder…), so it is told at the
//    field instead of discovering a broken box on the investor's screen.
// PersonAvatar (components/PersonAvatar.tsx) is the other half: whatever still fails to load falls back to the person's initials, never a broken box.

const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** The id inside a Google Drive share link, or null: /file/d/<id>/view|edit|preview, open?id=<id>, uc?id=<id>. A folder link has none. */
function driveFileId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;
  const fromPath = /\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(url.pathname)?.[1];
  const id = fromPath ?? ((url.pathname === '/open' || url.pathname === '/uc') ? url.searchParams.get('id') : null);
  return id && DRIVE_FILE_ID.test(id) ? id : null;
}

/** The address a browser can draw as an image — or '' when there is nothing usable (empty, or not an http(s) address). */
export function normalizePersonPhotoUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();
  if (!text) return '';
  // A path on our own site (`/something.png`) is a same-origin picture and was always drawn as typed; `//host/x` is a protocol-relative address.
  if (/^\/(?!\/)/.test(text)) return text;
  if (text.startsWith('//')) text = `https:${text}`;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';

  // Google Drive "anyone with the link" → the image host Drive itself redirects an image to (stable, sized, no interstitial).
  const driveId = driveFileId(url);
  if (driveId) return `https://lh3.googleusercontent.com/d/${driveId}=w512`;

  // Dropbox share links open a page unless asked for the raw file.
  const host = url.hostname.toLowerCase();
  if ((host === 'www.dropbox.com' || host === 'dropbox.com') && /^\/(s|scl)\//.test(url.pathname)) {
    url.searchParams.delete('dl');
    url.searchParams.set('raw', '1');
    return url.toString();
  }

  return text.match(/^[a-z][a-z0-9+.-]*:\/\//i) ? text : url.toString();
}

/**
 * Why this link can never be a picture, in a sentence a founder can act on — or null when nothing is known to be wrong with it. Not a check that the
 * address IS an image (that needs a network call); it only names the mistakes people actually make.
 */
export function personPhotoProblem(raw: unknown): string | null {
  const normalized = normalizePersonPhotoUrl(raw);
  if (!normalized) return typeof raw === 'string' && raw.trim() ? 'That is not a web address (it should start with https://).' : null;
  let url: URL;
  try { url = new URL(normalized); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((host === 'drive.google.com' || host === 'docs.google.com') && /\/(drive\/)?folders\//.test(url.pathname)) {
    return 'That is a Google Drive folder, not a picture. Share the picture itself (“Anyone with the link”) and paste that link.';
  }
  if (host === 'drive.google.com' && !driveFileId(url) && !/googleusercontent|thumbnail/.test(url.toString())) {
    return 'That Google Drive link does not point to a single file. Share the picture itself (“Anyone with the link”) and paste that link.';
  }
  if (/(^|\.)linkedin\.com$/.test(host) && /^\/(in|pub|company)\//.test(url.pathname)) {
    return 'That is a LinkedIn profile page, not a picture. Open the picture, right-click it and copy the image address — or upload it to Google Drive and share it.';
  }
  if (/(^|\.)(facebook|instagram|twitter|x)\.com$/.test(host) && !/\/(photo|photos|media)\b/.test(url.pathname) && url.pathname.split('/').filter(Boolean).length <= 1) {
    return 'That is a profile page, not a picture. Paste the link to the image itself.';
  }
  return null;
}

/** "David Luís Malhão Verde" → "DL": the first letters of the first two words, upper-cased — what the dossier has always shown when there is no photo. */
export function personInitials(name: unknown): string {
  const words = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean) : [];
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
