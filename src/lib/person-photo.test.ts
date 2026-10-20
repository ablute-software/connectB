// The Mob2is case (20/10/2026): a founder's photo link was a Google Drive "view" page — `text/html`, so every <img> that drew it was a broken box — while the file
// itself was public and the same id served as `image/jpeg` from lh3.googleusercontent.com. The share links people paste become the picture's own address;
// a link that can never be a picture is said at the field; and what still fails falls back to initials (PersonAvatar, tested below).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizePersonPhotoUrl, personInitials, personPhotoProblem } from './person-photo';
import { PersonAvatar, PersonAvatarView } from '@/components/PersonAvatar';

const ID = '1rNSDq6fW25WqESoY-dsUmQHS_6Z-6ttq';
const DIRECT = `https://lh3.googleusercontent.com/d/${ID}=w512`;

describe('normalizePersonPhotoUrl — a share link becomes the picture itself', () => {
  it('the exact link stored for Mob2is → the image address Drive itself serves', () => {
    expect(normalizePersonPhotoUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(DIRECT);
  });

  it.each([
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/file/d/${ID}/edit`,
    `https://drive.google.com/file/d/${ID}/preview`,
    `https://drive.google.com/file/u/0/d/${ID}/view?usp=drive_link`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?export=view&id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `  https://drive.google.com/file/d/${ID}/view?usp=sharing  `,
    `drive.google.com/file/d/${ID}/view`,
  ])('Google Drive: %s', (link) => {
    expect(normalizePersonPhotoUrl(link)).toBe(DIRECT);
  });

  it('Dropbox: the share page asks for the raw file instead', () => {
    expect(normalizePersonPhotoUrl('https://www.dropbox.com/s/abc123/me.jpg?dl=0')).toBe('https://www.dropbox.com/s/abc123/me.jpg?raw=1');
    const scl = new URL(normalizePersonPhotoUrl('https://www.dropbox.com/scl/fi/xyz/me.png?rlkey=KEY&dl=0'));
    expect(scl.searchParams.get('raw')).toBe('1');
    expect(scl.searchParams.get('rlkey')).toBe('KEY');
    expect(scl.searchParams.has('dl')).toBe(false);
  });

  it('an address that already is a picture is left exactly as typed (only trimmed)', () => {
    for (const direct of [DIRECT, 'https://example.com/team/ana.jpg', 'https://cdn.example.com/a.png?v=3&w=200', `https://drive.google.com/thumbnail?id=${ID}&sz=w256`]) {
      expect(normalizePersonPhotoUrl(`  ${direct}  `)).toBe(direct);
    }
  });

  it('a link with no scheme gets https://', () => {
    expect(normalizePersonPhotoUrl('example.com/ana.jpg')).toBe('https://example.com/ana.jpg');
  });

  it('a path on our own site is a same-origin picture and stays as typed; a protocol-relative address gets https:', () => {
    expect(normalizePersonPhotoUrl('/matchdeal-icon.svg')).toBe('/matchdeal-icon.svg');
    expect(normalizePersonPhotoUrl('  /badges/pioneer.png ')).toBe('/badges/pioneer.png');
    expect(normalizePersonPhotoUrl('//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
  });

  it('nothing usable gives an empty string: empty, not a string, not an http(s) address, not even a URL', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}, 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://example.com/a.jpg', 'not a url at all']) {
      expect(normalizePersonPhotoUrl(bad), String(bad)).toBe('');
    }
  });

  it('it is idempotent: normalising what was already normalised changes nothing (the stored value is safe to run through again)', () => {
    for (const link of [`https://drive.google.com/file/d/${ID}/view?usp=sharing`, 'https://www.dropbox.com/s/abc123/me.jpg?dl=0', 'example.com/ana.jpg', DIRECT]) {
      const once = normalizePersonPhotoUrl(link);
      expect(normalizePersonPhotoUrl(once)).toBe(once);
    }
  });

  it('a Drive FOLDER link has no file to point at: it is not rewritten', () => {
    const folder = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing';
    expect(normalizePersonPhotoUrl(folder)).toBe(folder);
  });
});

describe('personPhotoProblem — said at the field, in a founder\'s words', () => {
  it('nothing is wrong with a share link (it is fixed on save), a direct picture, or an empty field', () => {
    for (const ok of [`https://drive.google.com/file/d/${ID}/view?usp=sharing`, DIRECT, 'https://example.com/a.jpg', '', '   ', null]) {
      expect(personPhotoProblem(ok), String(ok)).toBeNull();
    }
  });

  it('a Google Drive folder, a Drive link with no file, a LinkedIn profile and a social profile page can never be a picture', () => {
    expect(personPhotoProblem('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv')).toMatch(/folder, not a picture/);
    expect(personPhotoProblem('https://drive.google.com/drive/u/0/my-drive')).toMatch(/does not point to a single file/);
    expect(personPhotoProblem('https://www.linkedin.com/in/ana-silva/')).toMatch(/LinkedIn profile page, not a picture/);
    expect(personPhotoProblem('https://instagram.com/anasilva')).toMatch(/profile page, not a picture/);
  });

  it('text that is not a web address is said so', () => {
    expect(personPhotoProblem('my picture')).toMatch(/not a web address/);
    expect(personPhotoProblem('javascript:alert(1)')).toMatch(/not a web address/);
  });
});

describe('personInitials — what the dossier has always shown when there is no photo', () => {
  it('the first letters of the first two words', () => {
    expect(personInitials('David Luís Malhão Verde')).toBe('DL');
    expect(personInitials('  tânia  silva ')).toBe('TS');
    expect(personInitials('Madonna')).toBe('MA');
    expect(personInitials('Ana-Maria Costa')).toBe('AM');
  });
  it('never empty: a missing name is a question mark', () => {
    for (const none of ['', '   ', '---', null, undefined, 3]) expect(personInitials(none), String(none)).toBe('?');
  });
});

describe('PersonAvatarView — a picture, or the initials; never a broken box', () => {
  const view = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PersonAvatarView, { name: 'David Luís Malhão Verde', src: null, ...props } as never));

  it('with an address: the picture, drawn from that address, with no referrer sent to the host that serves it', () => {
    const out = view({ src: DIRECT, className: 'h-8 w-8 rounded-full' });
    expect(out).toContain('data-person-avatar="photo"');
    expect(out).toContain(`src="${DIRECT}"`);
    expect(out).toContain('referrerPolicy="no-referrer"');
  });

  it('with none: the initials, in the fallback style', () => {
    const out = view({ src: null, className: 'h-8 w-8 rounded-full', fallbackClassName: 'bg-[#E8F4F8] text-[#0E7490]' });
    expect(out).toContain('data-person-avatar="initials"');
    expect(out).toContain('>DL<');
    expect(out).toContain('bg-[#E8F4F8]');
    expect(out).not.toContain('<img');
  });

  it('a caller with its own initials rule and background (the MatchDeal deck) keeps both', () => {
    const out = view({ src: null, initials: 'DV', className: 'h-12 w-12', fallbackStyle: { background: 'linear-gradient(135deg, #111, #222)' } });
    expect(out).toContain('>DV<');
    expect(out).toContain('linear-gradient(135deg, #111, #222)');
  });

  it('the picture state carries the circle but not the fallback colours', () => {
    const out = view({ src: 'https://example.com/a.jpg', className: 'h-8 w-8 rounded-full', fallbackClassName: 'bg-[#E8F4F8]' });
    expect(out).toContain('rounded-full');
    expect(out).not.toContain('bg-[#E8F4F8]');
  });
});

describe('PersonAvatar — the <img> is created only AFTER mount (a failing link fires `error` before React hydrates; a server-rendered <img> would keep its broken box)', () => {
  const ssr = (photoUrl: unknown) => renderToStaticMarkup(createElement(PersonAvatar, { name: 'David Luís Malhão Verde', photoUrl } as never));

  it('the first render (the server one, and the client one before it mounts) is the initials even when there IS a link: nothing to mismatch and no image to fail early', () => {
    for (const link of [`https://drive.google.com/file/d/${ID}/view?usp=sharing`, 'https://example.com/a.jpg', DIRECT]) {
      const out = ssr(link);
      expect(out, link).toContain('data-person-avatar="initials"');
      expect(out).not.toContain('<img');
    }
  });

  it('what turns the initials into the picture is the mounted flag, and what turns it back is onError — both in the component, in that order', () => {
    const src = readFileSync(path.resolve(__dirname, '../components/PersonAvatar.tsx'), 'utf8');
    expect(src).toContain('const [mounted, setMounted] = useState(false);');
    expect(src).toContain('useEffect(() => { setMounted(true); }, []);');
    expect(src).toContain('src={mounted && src && !failed ? src : null}');
    expect(src).toContain('onError={() => setFailed(true)}');
  });

  it('all three places that draw a team photo use it (none keeps its own <img src={photo_url}>)', () => {
    const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');
    expect(read('../components/company/StartupTeamCard.tsx')).toContain('<PersonAvatar ');
    expect(read('../components/matchdeal/MatchDealDeck.tsx')).toContain('<PersonAvatar ');
    expect(read('../components/portal/DossierOverviewSections.tsx')).toContain('<PersonAvatar ');
    expect(read('../components/company/StartupTeamCard.tsx')).not.toMatch(/<img src=\{p\.photo_url\}/);
    expect(read('../components/matchdeal/MatchDealDeck.tsx')).not.toMatch(/<img src=\{f\.photo_url\}/);
    expect(read('../components/portal/DossierOverviewSections.tsx')).not.toMatch(/<img src=\{p\.photoUrl\}/);
  });

  it('the Team card stores the address of the picture itself (a share link is normalised on save) and says so at the field when a link can never be a picture', () => {
    const card = readFileSync(path.resolve(__dirname, '../components/company/StartupTeamCard.tsx'), 'utf8');
    expect(card.match(/photo_url: normalizePersonPhotoUrl\(/g)).toHaveLength(2);
    expect(card).toContain('<PhotoHint value={v.photo_url} />');
    expect(card).toContain('personPhotoProblem(value)');
  });
});
