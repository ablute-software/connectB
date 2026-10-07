'use client';
// Prompt 903 — the one password field every sign-in / sign-up / reset / settings
// screen shares: the plain field plus an eye on the right that reveals what was
// typed. A founder reported (07/10/2026) that signup gave no way to see the
// password being chosen and, with no confirmation field, "pode dar asneira";
// the same bare <input type="password"> had been copy-pasted into eight other
// screens. On signup the eye REPLACES a "confirm password" field (product
// decision), so it has to behave identically everywhere.
//
// Same eye as PinInput.tsx (left untouched): same SVG paths, a type="button"
// that never submits a surrounding <form>, aria-label + aria-pressed. Four
// things a password field needs that a 4-digit code does not:
//  - onMouseDown preventDefault on the eye, so pressing it never pulls focus
//    out of the field being typed in;
//  - the caret stays where it was. Flipping the type of the focused field drops
//    its caret to position 0 once the click has finished (measured in Chromium,
//    07/10/2026, with a real click; a scripted .click() does not), and the next
//    keystroke would then land at the START of the password — exactly the
//    "asneira" the eye exists to prevent. The selection is put back afterwards;
//  - every ordinary <input> prop is forwarded to the <input> itself, notably
//    onKeyDown — login, reset, set-password and investor sign-in are NOT <form>s,
//    they submit on Enter through that handler — and autoComplete;
//  - the browser's own reveal control is hidden (Edge draws one inside every
//    type="password" field, which would sit under ours as a second eye).
//
// Layout contract: `wrapperClassName` positions the field (margins, grid/flex
// item sizing); `className` is the field's own look (border, radius, padding,
// text size). The eye is centred on the wrapper's height, so a margin put on the
// input itself would push the eye off-centre — margins belong on the wrapper.
//
// `autoComplete` is required, and narrowed to the two values that are right for
// a password, because leaving it off is silent: browsers and password managers
// then guess, and 6 of the 13 fields this replaced had no value at all.
import { useRef, useState, type InputHTMLAttributes, type Ref } from 'react';

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete'> & {
  autoComplete: 'new-password' | 'current-password';
  wrapperClassName?: string;
  iconSize?: number;
};

// Stateless half: all the markup and its wiring. Split from the stateful
// wrapper below so both can be asserted without a DOM — this repo has no
// component-test library (see PasswordInput.test.ts).
export function PasswordInputView({
  visible, onToggle, inputRef, autoComplete, wrapperClassName = '', className = '', iconSize = 16, ...inputProps
}: PasswordInputProps & { visible: boolean; onToggle: () => void; inputRef?: Ref<HTMLInputElement> }) {
  const label = visible ? 'Hide password' : 'Show password';
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        ref={inputRef}
        // A revealed password is a plain text field to the keyboard: stop phones
        // capitalising its first letter or "correcting" it. Callers may override.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // Named here rather than left to the spread: the Prompt 553 lint rule
        // looks for a literal autoComplete attribute on every <input>.
        autoComplete={autoComplete}
        {...inputProps}
        type={visible ? 'text' : 'password'}
        className={`block w-full ${className} pr-10 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`}
      />
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        disabled={inputProps.disabled}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex items-center rounded-md px-2.5 text-gray-400 hover:text-gray-600 disabled:opacity-40"
      >
        {visible ? (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function toggle() {
    const el = inputRef.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    const direction = el?.selectionDirection ?? undefined;
    setVisible((v) => !v);
    if (el && start !== null && end !== null && document.activeElement === el) {
      // Twice, because browsers settle at different moments: the next task
      // (where Chromium has already dropped the caret) and the next frame.
      // Idempotent, and a no-op once the field has lost focus. A caret at the end
      // of a password longer than the field is scrolled back into view too — the
      // type flip also resets the scroll, and setSelectionRange does not reveal.
      const restore = () => {
        if (document.activeElement !== el) return;
        el.setSelectionRange(start, end, direction);
        if (end === el.value.length) el.scrollLeft = el.scrollWidth;
      };
      setTimeout(restore, 0);
      requestAnimationFrame(restore);
    }
  }

  return <PasswordInputView {...props} inputRef={inputRef} visible={visible} onToggle={toggle} />;
}
