// Shared presentation bits for the investor-facing Invest pages. All
// user-visible copy comes from the caller's localized strings.
import React from 'react';

export function formatInvestDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function InvestLoading({ label }) {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" aria-hidden="true" />
      <span className="ml-3 text-sm text-gray-300">{label}</span>
    </div>
  );
}

export function InvestError({ message, retryLabel, onRetry }) {
  return (
    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5" role="alert">
      <p className="text-sm font-semibold text-red-300">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function InvestNotice({ tone = 'info', children }) {
  const styles = {
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  };
  return (
    <div className={`rounded-2xl border p-4 text-sm leading-relaxed ${styles[tone] || styles.info}`} role="note">
      {children}
    </div>
  );
}

export function InvestSection({ title, children, hint }) {
  return (
    <section className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-gray-400 leading-relaxed">{hint}</p> : null}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function InvestField({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-200">{label}</span>
      {hint ? <span className="mt-1 block text-xs text-gray-400 leading-relaxed">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const investInputClassName = 'w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none';
export const investButtonClassName = 'rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50';
export const investSecondaryButtonClassName = 'rounded-lg border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50';
