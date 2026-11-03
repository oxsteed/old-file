import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditSubNav } from './shared';
import OversightSection from './licence/OversightSection';
import ConsumerSection from './licence/ConsumerSection';
import MoneyOutSection from './licence/MoneyOutSection';
import DormancySection from './licence/DormancySection';
import AccessReviewSection from './licence/AccessReviewSection';
import ReportsSection from './licence/ReportsSection';
import WindDownSection from './licence/WindDownSection';
import ComplianceSection from './licence/ComplianceSection';
import FxLimitsSection from './licence/FxLimitsSection';

export const LICENCE_TABS = [
  { id: 'oversight', Component: OversightSection },
  { id: 'consumer', Component: ConsumerSection },
  { id: 'moneyOut', Component: MoneyOutSection },
  { id: 'compliance', Component: ComplianceSection },
  { id: 'dormancy', Component: DormancySection },
  { id: 'access', Component: AccessReviewSection },
  { id: 'reports', Component: ReportsSection },
  { id: 'windDown', Component: WindDownSection },
  { id: 'fx', Component: FxLimitsSection },
];

/** OxSteed Credit licence controls (/api/admin/super/credit-licence). */
export default function OxsteedCreditLicencePage() {
  const { t } = useTranslation('credit');
  const [tab, setTab] = useState(LICENCE_TABS[0].id);
  const Active = LICENCE_TABS.find((x) => x.id === tab)?.Component || OversightSection;
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
      <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('adminLicence.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{t('adminLicence.intro')}</p>
      </header>
      <div role="tablist" aria-label={t('adminLicence.title')} className="flex gap-2 overflow-x-auto pb-1">
        {LICENCE_TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`licence-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`licence-panel-${x.id}`}
            onClick={() => setTab(x.id)}
            className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold ${tab === x.id ? 'border-orange-500/60 bg-orange-500/15 text-orange-200' : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            {t(`adminLicence.tabs.${x.id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`licence-panel-${tab}`} aria-labelledby={`licence-tab-${tab}`}>
        <Active />
      </div>
    </main>
  );
}
