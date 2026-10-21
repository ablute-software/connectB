'use client';
// A person's round picture, with the initials as its fallback — never a broken-image box. One component for the three places a team member's photo is drawn
// (the founder's Team card, the MatchDeal deck, the investor's dossier): each used to draw `<img src={photo_url}>` on its own, so a link that does not open
// (a Google Drive "view" page, a LinkedIn address, an expired link) showed as "a photo that does not open" everywhere at once.
//
// The link goes through normalizePersonPhotoUrl first (a Drive/Dropbox share link becomes the image itself), and an image that still fails to load
// (`onError`) puts the initials in its place. `referrerPolicy="no-referrer"`: the picture is fetched from a host the founder chose; it does not need to
// be told which page of ours is showing it.
//
// WHY THE <img> IS ONLY CREATED AFTER MOUNT — found by running it in a browser, not by reading it: with the <img> in the server-rendered HTML, the browser
// starts loading it at once, and a link that fails (a dead host, a file that is not there) fires its `error` event BEFORE React has hydrated and attached
// `onError`. React does not replay it, so the broken box stayed and the fallback never ran — in exactly the case this component exists for. So the first
// render (server and client alike, hence no hydration mismatch) draws the initials, which double as the placeholder while a picture loads, and the <img>
// is created on the client with its handler already attached.
import { useEffect, useState, type CSSProperties } from 'react';
import { normalizePersonPhotoUrl, personInitials } from '@/lib/person-photo';

interface AvatarStyle {
  /** The circle: size, shape — applied to the picture and to the fallback alike. */
  className?: string;
  /** Extra classes only for the initials state (background and text colour). */
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
}

/** The two states, as markup only: `src` set → the picture; null → the initials. */
export function PersonAvatarView({ name, src, initials, onError, className = '', fallbackClassName = '', fallbackStyle }: AvatarStyle & {
  name: string; src: string | null; initials?: string; onError?: () => void;
}) {
  if (!src) {
    return (
      <span className={`flex items-center justify-center ${className} ${fallbackClassName}`} style={fallbackStyle} data-person-avatar="initials">
        {initials ?? personInitials(name)}
      </span>
    );
  }
  return (
    <span className={`flex items-center justify-center overflow-hidden ${className}`} data-person-avatar="photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" referrerPolicy="no-referrer" onError={onError} className="h-full w-full object-cover" />
    </span>
  );
}

export function PersonAvatar({ name, photoUrl, initials, className, fallbackClassName, fallbackStyle }: AvatarStyle & {
  name: string;
  photoUrl?: string | null;
  /** When the caller already has its own initials rule (the MatchDeal deck does). */
  initials?: string;
}) {
  const src = normalizePersonPhotoUrl(photoUrl);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // a different address gets its own chance
  useEffect(() => { setFailed(false); }, [src]);

  return (
    <PersonAvatarView name={name} src={mounted && src && !failed ? src : null} initials={initials} onError={() => setFailed(true)}
      className={className} fallbackClassName={fallbackClassName} fallbackStyle={fallbackStyle} />
  );
}
