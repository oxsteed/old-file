// client/src/components/registration/PasswordField.tsx
import { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}

const REQS = [
  { id: 'len', label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'num', label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

const LEVELS = ['Weak', 'Fair', 'Good', 'Strong'] as const;
const LEVEL_COLORS = [
  'bg-red-500',     // Weak
  'bg-yellow-500',  // Fair
  'bg-blue-500',    // Good
  'bg-green-500',   // Strong
];

export function scorePassword(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export default function PasswordField({ value, onChange, error }: Props) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  const score = scorePassword(value);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="password" className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
        Password
      </label>

      {/* Input with icon + toggle */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
          <Lock size={16} />
        </span>
        <input
          id="password"
          name="password"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Create a strong password"
          autoComplete="new-password"
          required
          className={`w-full py-3 pl-10 pr-10 bg-gray-800/50 border rounded-lg text-white text-sm placeholder-gray-500 transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 ${
            error ? 'border-red-500 bg-red-900/20' : 'border-gray-700 hover:border-gray-600'
          }`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {/* Strength meter — shows on focus */}
      {(focused || value.length > 0) && (
        <div className="flex flex-col gap-1.5 mt-1">
          {/* Bars */}
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`flex-1 h-[3px] rounded-full transition-colors duration-300 ${
                  i < score ? LEVEL_COLORS[score - 1] : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
          {value.length > 0 && (
            <span className="text-[11px] text-gray-400">{LEVELS[score - 1] || 'Too short'}</span>
          )}

          {/* Requirements */}
          <div className="flex flex-col gap-0.5">
            {REQS.map((req) => {
              const met = req.test(value);
              return (
                <div
                  key={req.id}
                  className={`flex items-center gap-2 text-[11px] transition-colors ${
                    met ? 'text-green-500' : 'text-gray-500'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                      met ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                  />
                  {req.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5" role="alert">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
