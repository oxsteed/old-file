// client/src/components/registration/OTPInput.tsx
// Compact single-field OTP input with wide tracking.
// Replaces the 6-box layout that was eating too much vertical space.

import { useRef } from 'react';

interface Props {
  value: string[];            // ['', '', '', '', '', '']
  onChange: (val: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
}

export default function OTPInput({ value, onChange, onComplete, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayValue = value.join('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
    const digits = raw.split('');
    const next = Array(6).fill('');
    digits.forEach((d, i) => { next[i] = d; });
    onChange(next);

    if (digits.length === 6) {
      onComplete?.(raw);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted.length) return;
    const next = Array(6).fill('');
    pasted.split('').forEach((d, i) => { next[i] = d; });
    onChange(next);
    if (pasted.length === 6) onComplete?.(pasted);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      maxLength={6}
      value={displayValue}
      disabled={disabled}
      onChange={handleChange}
      onPaste={handlePaste}
      placeholder="000000"
      autoFocus
      className="w-full h-11 text-center text-xl font-semibold tracking-[0.4em] border border-gray-700 rounded-lg bg-gray-800/50 text-white placeholder-gray-600 caret-orange-500 transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50"
      aria-label="6-digit verification code"
    />
  );
}
