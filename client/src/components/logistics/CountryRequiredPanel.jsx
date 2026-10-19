import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import CountrySelect from '../CountrySelect';
import { useAuth } from '../../context/AuthContext';
import { detectCountryFromLocale } from '../../lib/countries';

/**
 * Shown by logistics checkout when no country is on file. The server never
 * trusts a client-supplied buyer country, so the only way forward is saving
 * one to the account (PATCH /auth/me), then reloading checkout.
 */
export default function CountryRequiredPanel({ onSaved }) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth() || {};
  const [country, setCountry] = useState(() => detectCountryFromLocale(''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (!country) { setError(t('logistics.checkout.countryRequired.required')); return; }
    setSaving(true);
    setError(null);
    try {
      await api.patch('/auth/me', { country });
      try { await refreshUser?.(); } catch { /* checkout reload below is authoritative */ }
      onSaved?.();
    } catch {
      setError(t('logistics.checkout.countryRequired.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="lx-card lx-country-required" aria-labelledby="lx-country-required-title">
      <h2 id="lx-country-required-title">{t('logistics.checkout.countryRequired.title')}</h2>
      <p className="lx-t-small lx-t-muted">{t('logistics.checkout.countryRequired.body')}</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="lx-country-required-select" className="lx-label">{t('logistics.checkout.countryRequired.label')}</label>
        <CountrySelect
          id="lx-country-required-select"
          value={country}
          onChange={(value) => { setCountry(value); setError(null); }}
          required
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'lx-country-required-error' : undefined}
          className="lx-input"
        />
        {error && <p id="lx-country-required-error" role="alert" className="lx-t-small lx-mt-6 lx-country-required-error">{error}</p>}
        <div className="lx-btn-row lx-mt-6">
          <button type="submit" className="lx-action-primary" disabled={saving}>
            {saving ? t('logistics.checkout.countryRequired.saving') : t('logistics.checkout.countryRequired.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
