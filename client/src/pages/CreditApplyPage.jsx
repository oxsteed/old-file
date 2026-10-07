import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

const SURFACE_OPTIONS = ['food_online', 'food_pos', 'chat', 'jobs', 'direct', 'qr', 'subscriptions', 'delivery', 'consulting', 'invoices', 'products', 'rentals'];

/**
 * Credit Everywhere Phase 1 — self-serve participant apply.
 * A business owner or helper applies for their business/profile to accept
 * OxSteed Credit. The application lands in the admin pending queue;
 * activation needs a second admin plus Didit verification.
 */
export default function CreditApplyPage() {
  const { t } = useTranslation('credit');
  const [participantType, setParticipantType] = useState('business');
  const [businessId, setBusinessId] = useState('');
  const [notes, setNotes] = useState('');
  const [surfaces, setSurfaces] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const toggleSurface = (surface) => {
    setSurfaces((current) =>
      current.includes(surface) ? current.filter((s) => s !== surface) : [...current, surface]
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/oxsteed-credit/participants/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          participantType,
          businessId: businessId || undefined,
          notes: notes || undefined,
          allowedSurfaces: surfaces,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.message || t('creditApplyFailed'));
      }
      setDone(true);
    } catch (err) {
      setError(err.message || t('creditApplyFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">{t('creditApplyEyebrow')}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t('creditApplyTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">{t('creditApplyDescription')}</p>
      </header>
      {done ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-4 py-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{t('creditApplySubmitted')}</p>
            <p className="mt-1 text-emerald-400/80">{t('creditApplySubmittedDetail')}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-gray-800 bg-gray-950/40 p-5">
          {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/25 px-4 py-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <div>
            <span className="mb-2 block text-xs font-semibold text-gray-400">{t('creditApplyType')}</span>
            <div className="flex gap-3">
              {['business', 'helper'].map((type) => (
                <label key={type} className="flex items-center gap-2 rounded-xl border border-gray-700 px-4 py-3 text-sm text-gray-200 cursor-pointer hover:border-orange-400">
                  <input type="radio" name="participantType" value={type} checked={participantType === type} onChange={() => setParticipantType(type)} className="accent-orange-500" />
                  {t(type === 'business' ? 'adminParticipantTypeBusiness' : 'adminParticipantTypeHelper')}
                </label>
              ))}
            </div>
          </div>
          {participantType === 'business' && (
            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-400">{t('creditApplyBusinessId')}</span>
              <input required value={businessId} onChange={(event) => setBusinessId(event.target.value)} inputMode="numeric" placeholder={t('adminBusinessIdPlaceholder')} className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
            </label>
          )}
          <div>
            <span className="mb-2 block text-xs font-semibold text-gray-400">{t('creditApplySurfaces')}</span>
            <div className="flex flex-wrap gap-2">
              {SURFACE_OPTIONS.map((surface) => (
                <button key={surface} type="button" onClick={() => toggleSurface(surface)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${surfaces.includes(surface) ? 'border-orange-400 bg-orange-500/15 text-orange-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                  {surface}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="mb-1 block text-xs font-semibold text-gray-400">{t('creditApplyNotes')}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder={t('creditApplyNotesPlaceholder')} className="w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" />
          </label>
          <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('creditApplySubmit')}
          </button>
        </form>
      )}
    </main>
  );
}
