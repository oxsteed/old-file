import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Group 13 (695, D-404): domain recovery links for a customer whose
// Credit access was lost or restricted. Links only, to paths that
// already exist — re-apply on /credit/apply (a revoked participant sees
// the apply form again), the identity appeal on /wallet
// (IdentityVerificationPanel), and support on /support/escalation. No
// new recovery flow is built here.
export default function CreditDomainRecoveryLinks() {
  const { t } = useTranslation('credit');
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-4">
      <p className="text-sm font-semibold text-white">{t('creditDomainRecoveryTitle')}</p>
      <p className="text-sm text-gray-400">{t('creditDomainRecoveryIntro')}</p>
      <ul className="space-y-1 text-sm">
        <li>
          <Link className="text-orange-400 underline underline-offset-2 hover:text-orange-300" to="/credit/apply">
            {t('creditDomainRecoveryReapply')}
          </Link>
        </li>
        <li>
          <Link className="text-orange-400 underline underline-offset-2 hover:text-orange-300" to="/wallet">
            {t('creditDomainRecoveryAppeal')}
          </Link>
        </li>
        <li>
          <Link className="text-orange-400 underline underline-offset-2 hover:text-orange-300" to="/support/escalation">
            {t('creditDomainRecoverySupport')}
          </Link>
        </li>
      </ul>
    </div>
  );
}
