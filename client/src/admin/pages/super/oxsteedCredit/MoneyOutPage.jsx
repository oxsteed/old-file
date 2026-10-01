import { useTranslation } from 'react-i18next';
import {
  CreditSubNav,
} from './shared';
import OxsteedCreditMoneyOut from '../OxsteedCreditMoneyOut';

export default function OxsteedCreditMoneyOutPage() {
  const { t } = useTranslation('credit');
  return (
      <main className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <CreditSubNav />
      <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-[#17131d] via-[#111318] to-[#101923] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('adminSuperAdmin')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('moneyOutEyebrow')}</h1>
          </div>
        </div>
      </header>
      <OxsteedCreditMoneyOut />
      </main>
  );
}
