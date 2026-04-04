// client/src/components/registration/OTPInput.tsx
import { useRef, useCallback } from 'react';

interface Props {
  value: string[];            // ['', '', '', '', '', '']
  onChange: (val: string[]) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
}

export default function OTPInput({ value, onChange, onComplete, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback((i: number) => (el: HTMLInputElement | null) => {
    refs.current[i] = el;
  }, []);

  const handleInput = (i: number, v: string) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = [...value];
    next[i] = digit;
    onChange(next);

    if (digit && i < 5) refs.current[i + 1]?.focus();
    if (digit && i === 5 && next.every(d => d !== '')) {
      onComplete?.(next.join(''));
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted.length) return;
    const digits = pasted.split('');
    const next = [...value];
    digits.forEach((d, idx) => { if (idx < 6) next[idx] = d; });
    onChange(next);
    const focusIdx = Math.min(digits.length, 5);
    refs.current[focusIdx]?.focus();
    if (next.every(d => d !== '')) onComplete?.(next.join(''));
  };

  return (
    <div className="flex gap-2" onPaste={handlePaste} role="group" aria-label="6-digit verification code">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={setRef(i)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="flex-1 h-[52px] text-center text-lg font-semibold tracking-wider border border-gray-700 rounded-lg bg-gray-800/50 text-white caret-orange-500 transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50"
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
