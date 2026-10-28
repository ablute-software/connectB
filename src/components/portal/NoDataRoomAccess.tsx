'use client';
// Prompt 923 (A.3) — what /portal says to somebody who has no data room from any startup. It used to say "No active access for this account. If you believe this is an error, contact the founder." and offer only "Log
// out", even to a person who is a member of an investor firm or a founder (28/10/2026): a dead end. Now the page says what this area is, says that the person has nothing in it yet, and shows a button for EVERY area they do have.
// Somebody with no area at all still gets the generic, deliberately uninformative sentence (it must never reveal which emails have access) and the way out.
import Link from 'next/link';
import { AREA_ABOUT, AREA_LABEL, AREA_PATH, selectorOptions, type Area } from '@/lib/areas';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';

export const NO_DATA_ROOM_TEXT = "You don't have data-room access from any startup yet.";

export function NoDataRoomAccess({ areas, senderEmail, showLogout }: { areas: Area[]; senderEmail?: string | null; showLogout: boolean }) {
  // The data-room area itself is where they are: only the OTHER areas are offered.
  const others = selectorOptions(areas).filter((o) => o.area !== 'dataroom');
  return (
    <div className="mx-auto mt-16 max-w-md text-center text-sm text-gray-600" data-testid="no-data-room">
      {others.length > 0 ? (
        <>
          <h1 className="text-lg font-semibold text-gray-900">Data rooms</h1>
          <p className="mt-1 text-gray-500">{AREA_ABOUT.dataroom}</p>
          <p className="mt-3 font-medium text-gray-800" data-testid="no-data-room-text">{NO_DATA_ROOM_TEXT}</p>
          <p className="mt-1 text-gray-500">Your other areas:</p>
          <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
            {others.map((o) => (
              <Link key={o.area} href={AREA_PATH[o.area]} data-testid="no-data-room-area"
                className="min-h-[44px] rounded-xl bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b]">
                Go to your {AREA_LABEL[o.area].toLowerCase()}
              </Link>
            ))}
          </div>
        </>
      ) : (
        // Deliberately generic — identical wording whether this email has no grant, an expired grant, or was never invited. Never reveals which emails do or don't have access.
        <p className="text-gray-500" data-testid="no-access-generic">No active access for this account. If you believe this is an error, contact {senderEmail ?? 'the founder'}.</p>
      )}
      {showLogout && <div className="mt-4 flex justify-center"><LogoutButton /></div>}
    </div>
  );
}
