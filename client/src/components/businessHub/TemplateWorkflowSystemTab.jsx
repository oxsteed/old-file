import React from 'react';
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { TEMPLATE_REGISTRY } from '../profileTemplates/index';
import { getTemplateWorkflowSystem } from '../profileTemplates/templateWorkflowSystems.js';

function MetricCard({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-3xl border border-gray-800 bg-gray-950/80 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          {hint && <p className="mt-1 text-sm text-gray-400">{hint}</p>}
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-3 text-gray-300">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="rounded-[28px] border border-gray-800 bg-gray-900/95 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.18)] sm:p-6">
      <div className="mb-5 flex items-start gap-4">
        <div className="rounded-2xl border border-gray-800 bg-gray-950 p-3 text-gray-300">
          <Icon size={18} />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-1 text-sm leading-6 text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ChipList({ items = [] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-gray-800 bg-gray-950 px-3 py-1.5 text-xs font-medium text-gray-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function CompletionScore({ currentBiz, services, gallery, reviews, faqs, hours, members }) {
  const checks = [
    !!currentBiz?.business_name,
    services.length > 0,
    gallery.length > 0,
    reviews.length > 0,
    faqs.length > 0,
    hours.some((item) => !item.is_closed && item.start_time && item.end_time),
    members.length > 0,
    !!currentBiz?.description,
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

function buildReadinessChecklist({ currentBiz, services, gallery, faqs, hours, members, analytics, workflow }) {
  const hasHours = hours.some((item) => !item.is_closed && item.start_time && item.end_time);
  const revenue = analytics?.monthly_revenue ?? analytics?.revenue_this_month ?? 0;
  const jobs = analytics?.open_jobs ?? analytics?.active_jobs ?? 0;

  return [
    {
      key: 'identity',
      title: 'Business identity and description',
      done: !!currentBiz?.business_name && !!currentBiz?.description,
      tab: 'profile',
      help: 'Complete the business story, positioning, and public trust basics.',
    },
    {
      key: 'services',
      title: 'Service or package structure',
      done: services.length >= 2,
      tab: 'services',
      help: 'This template sells best when offers are packaged clearly for the industry.',
    },
    {
      key: 'proof',
      title: 'Proof assets and gallery',
      done: gallery.length >= 3,
      tab: 'gallery',
      help: 'Customers in this market need visible proof before they convert.',
    },
    {
      key: 'hours',
      title: 'Availability and operating rhythm',
      done: hasHours,
      tab: 'calendar',
      help: 'Set hours, appointment flow, and follow-up timing.',
    },
    {
      key: 'faq',
      title: 'Expectation-setting FAQ',
      done: faqs.length >= 3,
      tab: 'faqs',
      help: 'Answer the biggest buying questions for this industry up front.',
    },
    {
      key: 'team',
      title: 'Internal staff or collaborator context',
      done: members.length > 0,
      tab: 'team',
      help: 'Many templates perform better when responsibilities are clearly assigned.',
    },
    {
      key: 'activity',
      title: 'Active workflow traction',
      done: revenue > 0 || jobs > 0,
      tab: 'overview',
      help: 'A live workflow should show either revenue movement or active work.',
    },
    {
      key: 'systems',
      title: `${workflow.unlockedSystems.length}+ template-specific systems in use`,
      done: workflow.unlockedSystems.length >= 3,
      tab: 'workflow',
      help: 'This template is strongest when the team actively uses the recommended systems below.',
    },
  ];
}

function buildPriorityActions(checklist, workflow) {
  return checklist
    .filter((item) => !item.done)
    .slice(0, 3)
    .map((item, index) => ({
      id: item.key,
      order: index + 1,
      title: item.title,
      tab: item.tab,
      detail: item.help,
    }))
    .concat(
      checklist.every((item) => item.done)
        ? workflow.unlockedSystems.slice(0, 2).map((system, index) => ({
            id: `system-${system.tab}-${index}`,
            order: index + 1,
            title: system.label,
            tab: system.tab,
            detail: `Workflow is ready. Spend time inside ${system.label} to run the ${workflow.operatingModel.toLowerCase()} model better.`,
          }))
        : []
    );
}

export default function TemplateWorkflowSystemTab({
  activeTemplate = 'default',
  currentBiz,
  currentRole = 'owner',
  services = [],
  gallery = [],
  reviews = [],
  faqs = [],
  hours = [],
  members = [],
  analytics = null,
  onJumpTab,
}) {
  const registryEntry = TEMPLATE_REGISTRY[activeTemplate] || TEMPLATE_REGISTRY.default;
  const workflow = getTemplateWorkflowSystem(activeTemplate, registryEntry.category);
  const score = CompletionScore({ currentBiz, services, gallery, reviews, faqs, hours, members });
  const monthlyRevenue = analytics?.monthly_revenue ?? analytics?.revenue_this_month ?? 0;
  const openItems = analytics?.open_jobs ?? analytics?.active_jobs ?? 0;
  const checklist = buildReadinessChecklist({
    currentBiz,
    services,
    gallery,
    faqs,
    hours,
    members,
    analytics,
    workflow,
  });
  const completedChecklist = checklist.filter((item) => item.done).length;
  const priorityActions = buildPriorityActions(checklist, workflow);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.14),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-200">
              Template Workflow System
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">
              {registryEntry.name} internal workflow
            </h2>
            <p className="mt-3 text-sm leading-7 text-gray-300">
              {workflow.headline}
            </p>
            <p className="mt-3 text-sm leading-7 text-gray-400">
              {workflow.operatorBrief}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:min-w-[360px]">
            <MetricCard
              label="Workflow readiness"
              value={`${score}%`}
              hint="Based on live storefront and operating-system completeness."
              icon={CheckCircle2}
            />
            <MetricCard
              label="Business mode"
              value={workflow.operatingModel}
              hint={`Active role: ${currentRole}`}
              icon={Building2}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard label="Services live" value={services.length} hint="Offers available to sell" icon={Briefcase} />
        <MetricCard label="Gallery assets" value={gallery.length} hint="Proof and conversion fuel" icon={BarChart3} />
        <MetricCard label="Monthly revenue" value={monthlyRevenue ? `$${Number(monthlyRevenue).toFixed(0)}` : '$0'} hint="Current tracked month" icon={Target} />
        <MetricCard label="Open work" value={openItems} hint="Tracked active jobs or tasks" icon={Clock3} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Workflow Readiness Checklist"
          subtitle="These checks translate the template into an actual internal operating setup."
          icon={CheckCircle2}
        >
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Checklist completion</p>
              <p className="mt-1 text-sm text-gray-300">
                {completedChecklist} of {checklist.length} workflow requirements are currently in place.
              </p>
            </div>
            <div className="text-2xl font-semibold text-white">{Math.round((completedChecklist / checklist.length) * 100)}%</div>
          </div>
          <div className="space-y-3">
            {checklist.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onJumpTab?.(item.tab)}
                className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-left transition hover:border-orange-400/25 hover:bg-gray-900"
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-orange-400/15 text-orange-300'}`}>
                    <CheckCircle2 size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.done ? 'bg-emerald-400/10 text-emerald-300' : 'bg-orange-400/10 text-orange-300'}`}>
                        {item.done ? 'Ready' : 'Needs work'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-gray-400">{item.help}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Next Best Actions"
          subtitle="If you only do a few things next, do these first for this template."
          icon={Sparkles}
        >
          <div className="space-y-3">
            {priorityActions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onJumpTab?.(item.tab)}
                className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-4 text-left transition hover:border-orange-400/25 hover:bg-gray-900"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-400 text-sm font-semibold text-gray-950">
                    {item.order}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-gray-400">{item.detail}</p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-gray-500" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          title="Demand This Template Is Built To Serve"
          subtitle="Use these demand patterns to decide how this business should be packaged, staffed, and sold."
          icon={Target}
        >
          <ChipList items={workflow.primaryDemand} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Intake requirements</p>
              <ul className="mt-3 space-y-2">
                {workflow.intakeRequirements.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                    <ArrowRight size={14} className="mt-1 shrink-0 text-orange-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Quality controls</p>
              <ul className="mt-3 space-y-2">
                {workflow.qualityControls.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                    <ShieldCheck size={14} className="mt-1 shrink-0 text-emerald-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Systems Unlocked By This Template"
          subtitle="These are the internal workspaces this industry should lean on every week."
          icon={Building2}
        >
          <div className="space-y-3">
            {workflow.unlockedSystems.map((item) => (
              <button
                key={`${item.tab}-${item.label}`}
                type="button"
                onClick={() => onJumpTab?.(item.tab)}
                className="w-full rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-left transition hover:border-orange-400/30 hover:bg-gray-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{item.label}</p>
                    <p className="mt-1 text-sm leading-6 text-gray-400">{item.reason}</p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-gray-500" />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          title="Operating Workflow"
          subtitle="This is the internal lifecycle the team should run every time this template wins demand."
          icon={Calendar}
        >
          <div className="space-y-4">
            {workflow.workflowStages.map((stage, index) => (
              <div key={stage} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-400 text-sm font-semibold text-gray-950">
                  {index + 1}
                </div>
                <p className="pt-1 text-sm leading-6 text-gray-300">{stage}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Records The Team Must Maintain"
          subtitle="These are the internal operating records that keep this template credible and scalable."
          icon={FileText}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {workflow.records.map((record) => (
              <div
                key={record}
                className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-300"
              >
                {record}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Daily Cadence"
          subtitle="The tight loop operators should run every day."
          icon={Clock3}
        >
          <ul className="space-y-2">
            {workflow.dailyCadence.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <CheckCircle2 size={14} className="mt-1 shrink-0 text-orange-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Weekly Cadence"
          subtitle="The optimization loop that keeps the business sharp."
          icon={Calendar}
        >
          <ul className="space-y-2">
            {workflow.weeklyCadence.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <CheckCircle2 size={14} className="mt-1 shrink-0 text-orange-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Monthly Cadence"
          subtitle="The business-review loop for pricing, growth, and retention."
          icon={BarChart3}
        >
          <ul className="space-y-2">
            {workflow.monthlyCadence.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <CheckCircle2 size={14} className="mt-1 shrink-0 text-orange-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard
          title="Retention And Monetization Plays"
          subtitle="Use these growth motions to turn the template into a real operating advantage."
          icon={Users}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {workflow.monetization.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-300"
              >
                {item}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Template-Specific Internal Promise"
          subtitle="What this activated template should enable behind the scenes, not just on the public profile."
          icon={MessageSquare}
        >
          <p className="text-sm leading-7 text-gray-300">
            {registryEntry.name} is expected to change how the team packages demand, collects intake, routes work, preserves trust, and grows repeat revenue. Use this workspace as the operating playbook for that template, then run the linked systems from Services, Schedule, Clients, Messages, Quotes, Reviews, and Growth Center with this industry in mind.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
