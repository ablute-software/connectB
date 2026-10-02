'use client';
// A 4-digit code field that masks what's typed (one dot per digit) with an
// eye toggle to reveal it on demand. Shared by every place a Vault Data Room
// code is typed (VaultPinGate setup/confirm/unlock, Settings' owner-managed
// code per member) — a plain type="text" field showed the code on screen
// while it was being entered, which defeats the point of a look-over-the-
// shoulder deterrent (see VaultPinGate.tsx's own header). Digits only,
// max 4; callers keep their own validation/submit logic.
import { useState } from 'react';

export function PinInput({
  value, onChange, placeholder = '0000', ariaLabel, disabled, autoFocus, onEnter,
  wrapperClassName = '', inputClassName = '', iconSize = 16,
}: {
  value: string;
  onChange: (digits: string) => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  wrapperClassName?: string;
  inputClassName?: string;
  iconSize?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
        inputMode="numeric"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`w-full pr-8 ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? 'Hide code' : 'Show code'}
        aria-pressed={visible}
        title={visible ? 'Hide code' : 'Show code'}
        className="absolute inset-y-0 right-1.5 flex items-center text-gray-400 hover:text-gray-600 disabled:opacity-40"
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
