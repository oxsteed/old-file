import { useState, type FormEvent } from 'react';
import LegalPageLayout from '../components/LegalPageLayout';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';

function DoNotSellForm() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || '');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(t('doNotSellPage.errorRequired'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/legal/ccpa-requests', {
        requestType: 'opt_out',
        email: trimmedEmail,
        requestNotes: notes.trim() || undefined,
      });
      setSuccess(true);
    } catch {
      setError(t('doNotSellPage.errorFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-5" role="status">
        <h3 className="text-base font-bold text-green-600 dark:text-green-400 mb-2">
          {t('doNotSellPage.successTitle')}
        </h3>
        <p>{t('doNotSellPage.successMessage')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 dark:border-gray-700 p-5 space-y-4">
      <div>
        <label htmlFor="dns-email" className="block text-sm font-semibold mb-1">
          {t('doNotSellPage.emailLabel')}
        </label>
        <input
          id="dns-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('doNotSellPage.emailPlaceholder')}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="dns-notes" className="block text-sm font-semibold mb-1">
          {t('doNotSellPage.notesLabel')}
        </label>
        <textarea
          id="dns-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('doNotSellPage.notesPlaceholder')}
          maxLength={1000}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2"
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-orange-500 px-4 py-2 font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
      >
        {submitting ? t('doNotSellPage.submittingButton') : t('doNotSellPage.submitButton')}
      </button>
    </form>
  );
}

export default function DoNotSell({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();

  return (
    <LegalPageLayout
      title={t('doNotSellPage.title')}
      description={t('doNotSellPage.doesNotSellText1')}
      effectiveDate="2026-03-22"
      embedded={embedded}
    >
      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.doesNotSellYourDataTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.doesNotSellText1')}
        </p>
        <p className="mb-3">
          {t('doNotSellPage.doesNotSellText2')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.rightsTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.rightsIntro')}
        </p>
        <ul className="list-disc ml-5 space-y-2 mb-3">
          <li>{t('doNotSellPage.rightsItem1')}</li>
          <li>{t('doNotSellPage.rightsItem2')}</li>
          <li>{t('doNotSellPage.rightsItem3')}</li>
          <li>{t('doNotSellPage.rightsItem4')}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.otherStateLawsTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.otherStateLawsText')}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.formTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.formIntro')}
        </p>
        <DoNotSellForm />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-orange-400 mb-3">
          {t('doNotSellPage.contactTitle')}
        </h2>
        <p className="mb-3">
          {t('doNotSellPage.contactIntro')}
        </p>
        <p className="mb-3">
          <strong>{t('doNotSellPage.contactEmailLabel')}</strong> privacy@oxsteed.com<br />
          <strong>{t('doNotSellPage.contactMailLabel')}</strong> OxSteed LLC, Springfield, OH 45503
        </p>
      </section>
    </LegalPageLayout>
  );
}
