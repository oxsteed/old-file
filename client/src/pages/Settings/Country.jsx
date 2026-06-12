import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Globe, Check, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import { listCountries, getSelectedCountry, setSelectedCountry } from '../../api/countryConfig';

// Country picker (docs/oxsteed-pack-architecture.md §5).
// Available countries are selectable; coming-soon countries are visible but
// inert. The list is fully server-driven — this page never names a country.

export default function CountrySettings() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState([]);
  const [comingSoon, setComingSoon] = useState([]);
  const [selected, setSelected] = useState(getSelectedCountry());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCountries()
      .then((list) => {
        setAvailable(list.available || []);
        setComingSoon(list.coming_soon || []);
        // If the saved selection is no longer active, fall back to the first
        // available country (mirrors the iOS CountryStore behavior).
        const codes = (list.available || []).map((c) => c.code);
        if (codes.length && !codes.includes(getSelectedCountry())) {
          setSelectedCountry(codes[0]);
          setSelected(codes[0]);
        }
      })
      .catch(() => toast.error(t('common.failedToLoad')))
      .finally(() => setLoading(false));
  }, [t]);

  const choose = (entry) => {
    if (entry.code === selected) return;
    setSelectedCountry(entry.code);
    setSelected(entry.code);
    toast.success(`${entry.flag_emoji || ''} ${entry.name}`.trim());
  };

  const row = (entry, selectable) => {
    const isSelected = selectable && entry.code === selected;
    return (
      <button
        key={entry.code}
        type="button"
        disabled={!selectable}
        onClick={() => selectable && choose(entry)}
        className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border text-left transition ${
          isSelected
            ? 'border-orange-500/50 bg-orange-500/10'
            : 'border-gray-800 bg-gray-900'
        } ${selectable ? 'hover:border-gray-600 cursor-pointer' : 'opacity-60 cursor-default'}`}
        aria-pressed={isSelected}
      >
        <span className="text-2xl w-11 h-11 flex items-center justify-center rounded-xl bg-gray-800 shrink-0">
          {entry.flag_emoji || '🌍'}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-bold ${selectable ? 'text-white' : 'text-gray-400'}`}>
            {entry.name}
          </span>
          {Array.isArray(entry.locales) && entry.locales.length > 0 && (
            <span className="block text-[11px] text-gray-500 font-medium mt-0.5">
              {entry.locales.map((l) => l.toUpperCase()).join(' · ')}
            </span>
          )}
        </span>
        {isSelected && <Check size={18} className="text-orange-400 shrink-0" />}
        {!selectable && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full shrink-0">
            <Clock size={10} />
            {t('country.comingSoonBadge')}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <Navbar />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition text-sm"
          >
            <ArrowLeft size={16} />
            {t('common.goBack')}
          </Link>

          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
              <Globe size={20} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{t('country.title')}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{t('country.subtitle')}</p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <svg className="animate-spin h-6 w-6 text-orange-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-8">
              {available.length > 0 && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                    {t('country.available')}
                  </h2>
                  <div className="space-y-2.5">{available.map((c) => row(c, true))}</div>
                </section>
              )}

              {comingSoon.length > 0 && (
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                    {t('country.comingSoon')}
                  </h2>
                  <div className="space-y-2.5">{comingSoon.map((c) => row(c, false))}</div>
                  <p className="text-xs text-gray-500 mt-3">{t('country.comingSoonHint')}</p>
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
