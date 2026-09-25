import React from 'react';
import { useTranslation } from 'react-i18next';
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

function buildReadinessChecklist({ currentBiz, services, gallery, faqs, hours, members, analytics, workflow, t }) {
  const hasHours = hours.some((item) => !item.is_closed && item.start_time && item.end_time);
  const revenue = analytics?.monthly_revenue ?? analytics?.revenue_this_month ?? 0;
  const jobs = analytics?.open_jobs ?? analytics?.active_jobs ?? 0;

  return [
    {
      key: 'identity',
      title: t('businessHub.templateWorkflow.checklist.identity.title'),
      done: !!currentBiz?.business_name && !!currentBiz?.description,
      tab: 'profile',
      help: t('businessHub.templateWorkflow.checklist.identity.help'),
    },
    {
      key: 'services',
      title: t('businessHub.templateWorkflow.checklist.services.title'),
      done: services.length >= 2,
      tab: 'services',
      help: t('businessHub.templateWorkflow.checklist.services.help'),
    },
    {
      key: 'proof',
      title: t('businessHub.templateWorkflow.checklist.proof.title'),
      done: gallery.length >= 3,
      tab: 'gallery',
      help: t('businessHub.templateWorkflow.checklist.proof.help'),
    },
    {
      key: 'hours',
      title: t('businessHub.templateWorkflow.checklist.hours.title'),
      done: hasHours,
      tab: 'calendar',
      help: t('businessHub.templateWorkflow.checklist.hours.help'),
    },
    {
      key: 'faq',
      title: t('businessHub.templateWorkflow.checklist.faq.title'),
      done: faqs.length >= 3,
      tab: 'faqs',
      help: t('businessHub.templateWorkflow.checklist.faq.help'),
    },
    {
      key: 'team',
      title: t('businessHub.templateWorkflow.checklist.team.title'),
      done: members.length > 0,
      tab: 'team',
      help: t('businessHub.templateWorkflow.checklist.team.help'),
    },
    {
      key: 'activity',
      title: t('businessHub.templateWorkflow.checklist.activity.title'),
      done: revenue > 0 || jobs > 0,
      tab: 'overview',
      help: t('businessHub.templateWorkflow.checklist.activity.help'),
    },
    {
      key: 'systems',
      title: t('businessHub.templateWorkflow.checklist.systems.title', { count: workflow.unlockedSystems.length }),
      done: workflow.unlockedSystems.length >= 3,
      tab: 'workflow',
      help: t('businessHub.templateWorkflow.checklist.systems.help'),
    },
  ];
}

function buildPriorityActions(checklist, workflow, t) {
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
            detail: t('businessHub.templateWorkflow.readySystemDetail', { system: system.label, model: workflow.operatingModel.toLowerCase() }),
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
  const { t } = useTranslation();
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
    t,
  });
  const completedChecklist = checklist.filter((item) => item.done).length;
  const priorityActions = buildPriorityActions(checklist, workflow, t);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.14),_transparent_36%),linear-gradient(135deg,rgba(17,24,39,0.98),rgba(15,23,42,0.96))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-200">
              {t('businessHub.templateWorkflow.badge')}
            </span>
            <h2 className="mt-4 text-3xl font-semibold text-white">
              {t('businessHub.templateWorkflow.internalWorkflow', { name: registryEntry.name })}
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
              label={t('businessHub.templateWorkflow.metrics.workflowReadiness.label')}
              value={`${score}%`}
              hint={t('businessHub.templateWorkflow.metrics.workflowReadiness.hint')}
              icon={CheckCircle2}
            />
            <MetricCard
              label={t('businessHub.templateWorkflow.metrics.businessMode.label')}
              value={workflow.operatingModel}
              hint={t('businessHub.templateWorkflow.metrics.businessMode.hint', { role: currentRole })}
              icon={Building2}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard label={t('businessHub.templateWorkflow.metrics.servicesLive.label')} value={services.length} hint={t('businessHub.templateWorkflow.metrics.servicesLive.hint')} icon={Briefcase} />
        <MetricCard label={t('businessHub.templateWorkflow.metrics.galleryAssets.label')} value={gallery.length} hint={t('businessHub.templateWorkflow.metrics.galleryAssets.hint')} icon={BarChart3} />
        <MetricCard label={t('businessHub.templateWorkflow.metrics.monthlyRevenue.label')} value={monthlyRevenue ? `$${Number(monthlyRevenue).toFixed(0)}` : '$0'} hint={t('businessHub.templateWorkflow.metrics.monthlyRevenue.hint')} icon={Target} />
        <MetricCard label={t('businessHub.templateWorkflow.metrics.openWork.label')} value={openItems} hint={t('businessHub.templateWorkflow.metrics.openWork.hint')} icon={Clock3} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title={t('businessHub.templateWorkflow.sections.readiness.title')}
          subtitle={t('businessHub.templateWorkflow.sections.readiness.subtitle')}
          icon={CheckCircle2}
        >
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessHub.templateWorkflow.checklistCompletion')}</p>
              <p className="mt-1 text-sm text-gray-300">
                {t('businessHub.templateWorkflow.checklistProgress', { completed: completedChecklist, total: checklist.length })}
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
                        {item.done ? t('businessHub.templateWorkflow.ready') : t('businessHub.templateWorkflow.needsWork')}
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
          title={t('businessHub.templateWorkflow.sections.nextActions.title')}
          subtitle={t('businessHub.templateWorkflow.sections.nextActions.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.demand.title')}
          subtitle={t('businessHub.templateWorkflow.sections.demand.subtitle')}
          icon={Target}
        >
          <ChipList items={workflow.primaryDemand} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessHub.templateWorkflow.intakeRequirements')}</p>
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
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{t('businessHub.templateWorkflow.qualityControls')}</p>
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
          title={t('businessHub.templateWorkflow.sections.systems.title')}
          subtitle={t('businessHub.templateWorkflow.sections.systems.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.operating.title')}
          subtitle={t('businessHub.templateWorkflow.sections.operating.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.records.title')}
          subtitle={t('businessHub.templateWorkflow.sections.records.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.daily.title')}
          subtitle={t('businessHub.templateWorkflow.sections.daily.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.weekly.title')}
          subtitle={t('businessHub.templateWorkflow.sections.weekly.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.monthly.title')}
          subtitle={t('businessHub.templateWorkflow.sections.monthly.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.monetization.title')}
          subtitle={t('businessHub.templateWorkflow.sections.monetization.subtitle')}
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
          title={t('businessHub.templateWorkflow.sections.promise.title')}
          subtitle={t('businessHub.templateWorkflow.sections.promise.subtitle')}
          icon={MessageSquare}
        >
          <p className="text-sm leading-7 text-gray-300">
            {t('businessHub.templateWorkflow.promiseBody', { name: registryEntry.name })}
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
