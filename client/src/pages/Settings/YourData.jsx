import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Database } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import { privacyDataAPI } from '../../api/privacyData';

const K = 'yourData';
const GROUPS = ['account', 'derived', 'internal'];

async function errorCode(err) {
  let payload = err?.response?.data;
  if (payload instanceof Blob) {
    try { payload = JSON.parse(await payload.text()); } catch { payload = null; }
  }
  return payload?.code || '';
}
const EXPORT_ERRORS = ['EXPORT_PASSWORD_INVALID', 'EXPORT_CODE_INVALID', 'EXPORT_CODE_EXPIRED', 'EXPORT_CODE_LOCKED', 'EXPORT_VERIFICATION_UNAVAILABLE', 'EXPORT_RESULT_LIMIT_EXCEEDED'];

// Customer 360 upgrade 11: what we hold about you, grouped the same way as
// the staff Customer 360 workspace, with the verified self-serve export.
export default function YourData() {
  const { t, i18n } = useTranslation();
  const copy = (key, options) => t(`${K}.${key}`, options);
  const lang = i18n.resolvedLanguage || i18n.language || 'en';
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [step, setStep] = useState('start');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ kind: '', text: '' });

  useEffect(() => {
    let live = true;
    privacyDataAPI.yourData()
      .then((r) => { if (live) { setData(r.data); setState('ready'); } })
      .catch(() => live && setState('error'));
    return () => { live = false; };
  }, []);

  const when = (v) => (v ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(v)) : copy('never'));
  const fail = async (err) => {
    const c = await errorCode(err);
    setMessage({ kind: 'error', text: copy(EXPORT_ERRORS.includes(c) ? `export.errors.${c}` : 'export.errors.generic') });
  };
  const requestCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage({ kind: '', text: '' });
    try {
      const r = await privacyDataAPI.requestExportCode(password);
      setChallenge(r.data);
      setPassword('');
      setStep('code');
      setMessage({ kind: 'ok', text: copy('export.codeSent', { email: r.data.emailHint }) });
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };
  const download = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage({ kind: '', text: '' });
    try {
      const v = await privacyDataAPI.verifyExportCode(challenge.challengeToken, code.trim());
      const r = await privacyDataAPI.downloadExport(v.data.exportToken);
      const name = (r.headers?.['content-disposition'] || '').match(/filename="([^"]+)"/i)?.[1] || 'oxsteed-data-export.zip';
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStep('start');
      setCode('');
      setChallenge(null);
      setMessage({ kind: 'ok', text: copy('export.done') });
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-content">
      <Navbar />
      <main className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-3xl" data-page="your-data">
          <Link to="/settings" className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition hover:text-content">
            <ArrowLeft size={16} className="rtl:rotate-180" /> {copy('back')}
          </Link>
          <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <Database className="shrink-0 text-primary" size={28} />
              <div>
                <h1 className="text-2xl font-bold text-content">{copy('title')}</h1>
                <p className="text-sm text-muted">{copy('subtitle')}</p>
              </div>
            </div>
            {state === 'loading' && <p role="status">{copy('loading')}</p>}
            {state === 'error' && <p role="alert">{copy('loadFailed')}</p>}
            {data && GROUPS.map((g) => {
              const items = data.categories.filter((c) => c.group === g);
              if (!items.length) return null;
              return (
                <section key={g} className="mb-8" aria-labelledby={`yd-${g}`}>
                  <h2 id={`yd-${g}`} className="mb-1 text-lg font-semibold">{copy(`groups.${g}.title`)}</h2>
                  <p className="mb-3 text-sm text-muted">{copy(`groups.${g}.hint`)}</p>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {items.map((c) => (
                      <li key={c.key} data-category={c.key} className="min-w-0 rounded-lg border border-border p-4">
                        <h3 className="font-medium break-words">{copy(`categories.${c.key}.title`)}</h3>
                        <p className="text-sm text-muted break-words">{copy(`categories.${c.key}.description`)}</p>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                          {c.count != null && (<><dt className="text-muted">{copy('records')}</dt><dd>{new Intl.NumberFormat(lang).format(c.count)}</dd></>)}
                          {c.count != null && (<><dt className="text-muted">{copy('lastUpdated')}</dt><dd>{when(c.lastAt)}</dd></>)}
                          <dt className="text-muted">{copy('inExport')}</dt><dd>{copy(`exportModes.${c.export}`)}</dd>
                          <dt className="text-muted">{copy('onDeletion')}</dt><dd>{copy(`erasure.${c.onErasure}`)}</dd>
                        </dl>
                        {!c.complete && <p className="mt-2 text-xs text-muted">{copy('partial')}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <section aria-labelledby="yd-export" className="rounded-lg border border-border p-4">
              <h2 id="yd-export" className="mb-1 text-lg font-semibold">{copy('export.title')}</h2>
              <p className="mb-3 text-sm text-muted">{copy('export.hint')}</p>
              {message.text && <p role={message.kind === 'error' ? 'alert' : 'status'} className="mb-3 text-sm">{message.text}</p>}
              {step === 'start' ? (
                <form onSubmit={requestCode} className="flex flex-wrap items-end gap-3" data-track-private>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {copy('export.password')}
                    <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-md border border-border bg-transparent px-3 py-2" />
                  </label>
                  <button type="submit" disabled={busy || !password} className="sp-btn sp-btn-primary">{copy('export.sendCode')}</button>
                </form>
              ) : (
                <form onSubmit={download} className="flex flex-wrap items-end gap-3" data-track-private>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {copy('export.code')}
                    <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="rounded-md border border-border bg-transparent px-3 py-2" />
                  </label>
                  <button type="submit" disabled={busy || code.length !== 6} className="sp-btn sp-btn-primary">{copy('export.download')}</button>
                  <button type="button" disabled={busy} onClick={() => { setStep('start'); setChallenge(null); setCode(''); }} className="sp-btn sp-btn-ghost">{copy('export.startOver')}</button>
                </form>
              )}
              <p className="mt-4 text-sm text-muted">{copy('deleteHint')} <Link to="/settings" className="underline">{copy('deleteLink')}</Link></p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
