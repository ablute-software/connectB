// Prompt 537 §1(a) — one clipboard helper, because two surfaces now offer
// "Copy guest link" and a second copy of the fallback logic is a second
// place for it to rot.
//
// The execCommand path is not legacy padding: navigator.clipboard is
// unavailable on insecure origins and throws under some in-app browsers,
// and this button's entire purpose is to work when the email did not.
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* falls through to the execCommand path below */ }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
