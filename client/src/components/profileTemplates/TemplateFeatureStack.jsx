import React from 'react';
import {
  ClipboardList,
  Compass,
  Gem,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

function buildOfferings(pack, services = []) {
  if (services.length > 0) {
    return services.slice(0, 3).map((service) => ({
      title: service.name,
      detail:
        service.description ||
        (service.price
          ? `$${Number(service.price).toFixed(2)}${service.priceUnit ? ` / ${service.priceUnit}` : ''}`
          : 'Custom scoped offering'),
    }));
  }

  return (pack.sampleOfferings || []).slice(0, 3).map((title) => ({
    title,
    detail: 'Template-ready offering structure for this industry',
  }));
}

function StackSection({ title, icon: Icon, children }) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-gray-950/80 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/80">
          <Icon size={18} />
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function TemplateFeatureStack({ pack, profileData }) {
  if (!pack) return null;

  const offerings = buildOfferings(pack, profileData?.services || []);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <StackSection title="Industry Demand Fit" icon={Compass}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
            Built for
          </p>
          <p className="mt-2 text-base font-semibold text-white">{pack.marketLabel}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(pack.demandMoments || []).map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/75"
              >
                {item}
              </span>
            ))}
          </div>
        </StackSection>

        <StackSection title="What This Template Highlights" icon={Sparkles}>
          <div className="space-y-3">
            {(pack.differentiators || []).map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm leading-6 text-white/75"
              >
                {item}
              </div>
            ))}
          </div>
        </StackSection>

        <StackSection title="How Clients Usually Buy This Service" icon={ClipboardList}>
          <div className="space-y-3">
            {(pack.workflow || []).map((item, index) => (
              <div key={item} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-950">
                  {index + 1}
                </div>
                <p className="text-sm leading-6 text-white/75">{item}</p>
              </div>
            ))}
          </div>
        </StackSection>

        <StackSection title="Signature Offer Structure" icon={Gem}>
          <div className="space-y-3">
            {offerings.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-white/65">{item.detail}</p>
              </div>
            ))}
          </div>
        </StackSection>

        <div className="lg:col-span-2">
          <StackSection title="Client Expectations This Template Supports" icon={ShieldCheck}>
            <div className="grid gap-3 sm:grid-cols-3">
              {(pack.expectations || []).map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm leading-6 text-white/75"
                >
                  {item}
                </div>
              ))}
            </div>
            {(pack.trustSignals || []).length > 0 && (
              <div className="mt-5 border-t border-white/10 pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                  Trust signals
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pack.trustSignals.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/75"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </StackSection>
        </div>
      </div>
    </section>
  );
}
