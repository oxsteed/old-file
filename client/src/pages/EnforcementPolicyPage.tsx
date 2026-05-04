/**
 * EnforcementPolicyPage.tsx
 * Public page showing enforcement policies and user's current status
 * Route: /enforcement-policy
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Shield, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import useAuth from '../hooks/useAuth';
import AppealForm from '../components/AppealForm';

const EnforcementPolicyPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [selectedRestriction, setSelectedRestriction] = useState<any>(null);

  // Fetch public enforcement policy
  const { data: policy } = useQuery({
    queryKey: ['enforcement-policy'],
    queryFn: async () => {
      const res = await fetch('/api/enforcement-policy/policy');
      if (!res.ok) throw new Error('Failed to fetch policy');
      return res.json();
    },
  });

  // Fetch user's status if logged in
  const { data: myStatus } = useQuery({
    queryKey: ['my-enforcement-status'],
    queryFn: async () => {
      const res = await fetch('/api/enforcement-policy/my-status');
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    enabled: !!user,
  });

  return (
    <PageShell>
      <PageMeta
        title={t('enforcementPolicy.pageTitle')}
        description={t('enforcementPolicy.pageDescription')}
      />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        {/* Header */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-brand-500" />
            <h1 className="text-4xl font-bold text-white">
              {t('enforcementPolicy.title')}
            </h1>
          </div>
          <p className="text-lg text-gray-300">
            {t('enforcementPolicy.subtitle')}
          </p>
        </section>

        {/* User status if logged in */}
        {user && myStatus?.data && (
          <section className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              {t('enforcementPolicy.yourStatus')}
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">
                  {t('enforcementPolicy.overallStatus')}
                </p>
                <p className="text-2xl font-bold text-white mt-1">
                  {myStatus.data.overallStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">
                  {t('enforcementPolicy.reliability')}
                </p>
                <p className="text-2xl font-bold text-white mt-1">
                  {myStatus.data.reputation.reliabilityScore}%
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2 text-sm text-gray-300">
              <div>
                {t('enforcementPolicy.jobsCompleted')}: {myStatus.data.reputation.totalJobs}
              </div>
              <div>
                {t('enforcementPolicy.cancellations')}: {myStatus.data.reputation.cancelledJobs}
              </div>
              <div>
                {t('enforcementPolicy.cancellationRate')}: {myStatus.data.reputation.cancellationRate}
              </div>
            </div>

            {/* Active restrictions */}
            {myStatus.data.activeRestrictions?.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-700 space-y-4">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  {t('enforcementPolicy.activeRestrictions')}
                </h3>
                {myStatus.data.activeRestrictions.map((restriction: any) => (
                  <div
                    key={restriction.id}
                    className="bg-gray-900/50 border border-amber-700/30 rounded-lg p-4 space-y-2"
                  >
                    <p className="font-semibold text-white">
                      {t(`enforcementPolicy.restriction.${restriction.type}`)}
                    </p>
                    <p className="text-sm text-gray-300">{restriction.description}</p>
                    {restriction.canAppeal && (
                      <button
                        onClick={() => {
                          setSelectedRestriction(restriction);
                          setShowAppealForm(true);
                        }}
                        className="text-sm text-brand-400 hover:text-brand-300 font-semibold mt-2"
                      >
                        {t('enforcementPolicy.submitAppeal')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {myStatus.data.recommendations?.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-700 bg-blue-900/20 border border-blue-800/50 rounded-lg p-4">
                <p className="text-sm text-blue-200">
                  {myStatus.data.recommendations[0]}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Policy sections */}
        {policy?.data && (
          <>
            {/* Cancellation Policy */}
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-white">
                {t('enforcementPolicy.cancellationPolicyTitle')}
              </h2>
              <p className="text-gray-300">
                {policy.data.cancellationPolicy.description}
              </p>
              <div className="space-y-3">
                {policy.data.cancellationPolicy.thresholds.map((threshold: any) => (
                  <div
                    key={threshold.level}
                    className="border border-gray-700 rounded-lg p-4 space-y-2"
                  >
                    <p className="font-semibold text-white capitalize">
                      {threshold.level}: {threshold.cancellationRate}
                    </p>
                    <p className="text-sm text-gray-300">{threshold.message}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Helper Late Cancel Policy */}
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-white">
                {t('enforcementPolicy.helperLateCancelTitle')}
              </h2>
              <p className="text-gray-300">
                {policy.data.helperLateNicancePolicy.description}
              </p>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-2">
                <p className="text-sm">
                  <span className="text-gray-400">{t('enforcementPolicy.lateWindow')}:</span>
                  <span className="text-white ml-2">{policy.data.helperLateNicancePolicy.lateWindow}</span>
                </p>
              </div>
            </section>

            {/* Dispute Policy */}
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-white">
                {t('enforcementPolicy.disputePolicyTitle')}
              </h2>
              <p className="text-gray-300">
                {policy.data.disputePolicy.description}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase">{t('enforcementPolicy.submissionWindow')}</p>
                  <p className="text-white font-semibold mt-1">{policy.data.disputePolicy.submissionWindow}</p>
                </div>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase">{t('enforcementPolicy.resolutionTime')}</p>
                  <p className="text-white font-semibold mt-1">{policy.data.disputePolicy.resolutionTime}</p>
                </div>
              </div>
            </section>

            {/* Appeals Policy */}
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-white">
                {t('enforcementPolicy.appealsPolicyTitle')}
              </h2>
              <p className="text-gray-300">
                {policy.data.appeals.description}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase">{t('enforcementPolicy.appealWindow')}</p>
                  <p className="text-white font-semibold mt-1">{policy.data.appeals.window}</p>
                </div>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                  <p className="text-xs text-gray-400 uppercase">{t('enforcementPolicy.appealResponseTime')}</p>
                  <p className="text-white font-semibold mt-1">{policy.data.appeals.responseTime}</p>
                </div>
              </div>
              <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4">
                <p className="text-sm text-blue-200">{policy.data.appeals.process}</p>
              </div>
            </section>
          </>
        )}

        {/* Appeal Form Modal */}
        {showAppealForm && selectedRestriction && (
          <AppealForm
            restrictionId={selectedRestriction.id}
            onClose={() => {
              setShowAppealForm(false);
              setSelectedRestriction(null);
            }}
            onSuccess={() => {
              setShowAppealForm(false);
              setSelectedRestriction(null);
            }}
          />
        )}
      </div>
    </PageShell>
  );
};

export default EnforcementPolicyPage;
