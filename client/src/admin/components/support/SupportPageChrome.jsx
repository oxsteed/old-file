import { ChevronRight, ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function SupportPageShell({ children }) {
  const { pathname } = useLocation();
  const isInbox = pathname === '/admin/support';

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.08),transparent_24%),linear-gradient(180deg,#030712_0%,#0b1120_100%)] p-4 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        {!isInbox ? (
          <Link
            to="/admin/support"
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 text-sm text-gray-400 transition hover:border-orange-500/40 hover:text-white"
          >
            <ArrowLeft size={15} />
            Back to Support Inbox
          </Link>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function SupportHero({ icon: Icon, eyebrow, title, description, actions, stats }) {
  return (
    <section className="rounded-[28px] border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
            {Icon && <Icon size={15} />}
            {eyebrow}
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">{title}</h1>
          <p className="mt-3 text-sm leading-6 text-gray-400 md:text-[15px]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div> : null}
      </div>

      {stats?.length ? (
        <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stats.map((stat) => (
            <SupportMetricCard key={stat.label} {...stat} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SupportMetricCard({ icon: Icon, label, value, detail, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/85 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
        {Icon ? (
          <div className={`rounded-xl bg-gray-800 p-2 ${tone}`}>
            <Icon size={16} />
          </div>
        ) : null}
      </div>
      <div className={`text-2xl font-semibold ${tone}`}>{value ?? '-'}</div>
      {detail ? <div className="mt-1 text-sm text-gray-500">{detail}</div> : null}
    </div>
  );
}

export function SupportPanel({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`rounded-[28px] border border-gray-800 bg-gray-950/90 ${className}`}>
      {(title || subtitle || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 px-5 py-5">
          <div>
            {title ? <div className="text-lg font-semibold text-white">{title}</div> : null}
            {subtitle ? <div className="mt-1 text-sm text-gray-500">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function SupportEmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-dashed border-gray-800 bg-gray-900/40 px-6 text-center">
      <div className="mb-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 text-gray-500">
        {Icon ? <Icon size={28} /> : null}
      </div>
      <div className="text-base font-medium text-gray-200">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-gray-500">{body}</div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SupportActionButton({ icon: Icon, children, tone = 'secondary', type = 'button', ...props }) {
  const tones = {
    primary: 'bg-orange-600 text-white hover:bg-orange-700 border-orange-500/40',
    secondary: 'bg-gray-900 text-gray-300 hover:text-white hover:border-gray-600 border-gray-700',
    success: 'bg-green-600 text-white hover:bg-green-700 border-green-500/40',
  };

  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${tones[tone]} ${props.className || ''}`}
    >
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export function SupportRouteCard({ icon: Icon, title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-left transition hover:border-orange-500/40 hover:bg-gray-900"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gray-800 p-2 text-gray-300 group-hover:text-orange-300">
          <Icon size={15} />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-200">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div> : null}
        </div>
      </div>
      <ChevronRight size={14} className="text-gray-600 group-hover:text-orange-300" />
    </button>
  );
}

export function SupportTag({ children, tone = 'default' }) {
  const tones = {
    default: 'border-gray-700 bg-gray-800/70 text-gray-300',
    orange: 'border-orange-500/25 bg-orange-500/10 text-orange-300',
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
    green: 'border-green-500/25 bg-green-500/10 text-green-300',
    red: 'border-red-500/25 bg-red-500/10 text-red-300',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
