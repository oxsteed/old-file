import React from 'react';

/**
 * Shared empty-state block: centered icon, title, supporting copy, actions.
 * Structure modeled on helperDirectory/EmptyState.tsx; all user-visible copy
 * is localized by the caller and passed in as props.
 *
 * Props:
 * - icon:   lucide icon component (e.g. SearchX, BellOff)
 * - title:  localized heading string
 * - copy:   localized supporting paragraph (optional)
 * - actions: buttons/links rendered in a centered vertical stack (optional)
 * - className: replaces the default vertical padding when a tighter fit
 *              is needed (e.g. inside a dropdown panel)
 */
export default function EmptyState({ icon: Icon, title, copy, actions, className }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-6 px-6 text-center ${
        className || 'py-16'
      }`}
    >
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
        {Icon ? <Icon className="w-7 h-7 text-gray-400" aria-hidden="true" /> : null}
      </div>

      <div>
        <p className="text-gray-900 font-semibold text-lg">{title}</p>
        {copy ? (
          <p className="text-gray-500 text-sm mt-1 max-w-sm leading-relaxed">{copy}</p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">{actions}</div>
      ) : null}
    </div>
  );
}
