import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Loader2, Link2, Sparkles } from 'lucide-react';
import api from '../../api/axios';

/**
 * ProfileSlugField
 *
 * Lets a helper or business claim a vanity profile URL slug (e.g. /h/mike-plumber).
 * Live-checks availability as the user types and offers alternatives when taken.
 *
 * Props:
 *   type: 'helper' | 'business'
 *   businessId: required when type === 'business'
 *   initialSlug: currently claimed slug (or null)
 *   slugUpdatedAt: ISO timestamp of last change (for cooldown messaging)
 *   onChanged(slug): called after a successful claim
 */

const DEBOUNCE_MS = 400;

export default function ProfileSlugField({ type, businessId, initialSlug, slugUpdatedAt, onChanged }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialSlug || '');
  const [status, setStatus] = useState('idle'); // idle | checking | available | taken | invalid
  const [reason, setReason] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const timer = useRef(null);
  const seq = useRef(0);

  const prefix = type === 'business' ? '/b/' : '/h/';
  const normalized = value.trim().toLowerCase();
  const isCurrent = normalized && normalized === (initialSlug || '').toLowerCase();
  const dirty = normalized !== (initialSlug || '').toLowerCase();

  useEffect(() => {
    setValue(initialSlug || '');
    setStatus('idle');
    setSuggestions([]);
  }, [initialSlug]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const check = (slug) => {
    clearTimeout(timer.current);
    if (!slug) {
      setStatus('idle');
      setSuggestions([]);
      return;
    }
    if (slug === (initialSlug || '').toLowerCase()) {
      setStatus('idle');
      setSuggestions([]);
      return;
    }
    setStatus('checking');
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        const { data } = await api.get('/profile-slugs/check', { params: { slug, type } });
        if (seq.current !== mySeq) return;
        if (data.available) {
          setStatus('available');
          setReason(null);
          setSuggestions([]);
        } else if (data.reason === 'taken') {
          setStatus('taken');
          setReason('taken');
          setSuggestions(data.suggestions || []);
        } else {
          setStatus('invalid');
          setReason(data.reason);
          setSuggestions([]);
        }
      } catch {
        if (seq.current !== mySeq) return;
        setStatus('idle');
      }
    }, DEBOUNCE_MS);
  };

  const handleChange = (e) => {
    const next = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setValue(next);
    setCooldownUntil(null);
    check(next.trim());
  };

  const applySuggestion = (s) => {
    setValue(s);
    setCooldownUntil(null);
    check(s);
  };

  const handleSave = async () => {
    if (status !== 'available' || saving) return;
    setSaving(true);
    try {
      const url = type === 'business' ? `/businesses/${businessId}/slug` : '/helper-profile/slug';
      const { data } = await api.put(url, { slug: normalized });
      onChanged && onChanged(data.slug);
      setStatus('idle');
      setSuggestions([]);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'slug_taken') {
        setStatus('taken');
        setReason('taken');
        setSuggestions(err.response?.data?.suggestions || []);
      } else if (code === 'slug_cooldown') {
        setCooldownUntil(err.response?.data?.changeAvailableAt || null);
      } else {
        setStatus('invalid');
        setReason(err.response?.data?.code?.replace('slug_', '') || 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const reasonLabel = reason
    ? t(`profileSlug.reasons.${reason}`, { defaultValue: reason })
    : null;

  const statusColor =
    status === 'available' ? 'text-emerald-500'
    : status === 'taken' || status === 'invalid' ? 'text-red-500'
    : 'text-gray-400';

  return (
    <div className="profile-slug-field">
      <label className="block text-sm font-semibold mb-1">
        {t('profileSlug.title', { defaultValue: 'Profile link' })}
      </label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {t('profileSlug.description', {
          defaultValue: 'Pick a short, memorable link for your public profile. First come, first served.',
        })}
      </p>

      <div className="flex items-stretch gap-2">
        <div className="flex items-stretch flex-1 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden focus-within:ring-2 focus-within:ring-teal-500">
          <span className="px-3 flex items-center bg-gray-100 dark:bg-gray-700 text-gray-500 text-sm font-mono select-none">
            {typeof window !== 'undefined' ? window.location.host : ''}{prefix}
          </span>
          <input
            value={value}
            onChange={handleChange}
            placeholder={t('profileSlug.placeholder', { defaultValue: 'your-name' })}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 outline-none font-mono"
          />
          <span className={`px-3 flex items-center text-sm ${statusColor}`}>
            {status === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'available' && <Check className="w-4 h-4" />}
            {(status === 'taken' || status === 'invalid') && <X className="w-4 h-4" />}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status !== 'available' || saving}
          className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition"
        >
          {saving
            ? t('profileSlug.saving', { defaultValue: 'Saving…' })
            : t('profileSlug.save', { defaultValue: 'Save' })}
        </button>
      </div>

      {/* Status line */}
      {status === 'available' && (
        <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <Link2 className="w-3.5 h-3.5" />
          {t('profileSlug.available', { defaultValue: 'This link is available!' })}
        </p>
      )}
      {status === 'taken' && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {t('profileSlug.taken', { defaultValue: 'That link is taken. Try one of these:' })}
        </p>
      )}
      {status === 'invalid' && reasonLabel && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{reasonLabel}</p>
      )}
      {cooldownUntil && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {t('profileSlug.cooldown', {
            defaultValue: 'You changed your link recently. You can change it again after {{date}}.',
            date: new Date(cooldownUntil).toLocaleDateString(),
          })}
        </p>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySuggestion(s)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 text-teal-700 dark:text-teal-300 text-xs font-mono hover:bg-teal-100 dark:hover:bg-teal-900/60 transition"
            >
              <Sparkles className="w-3 h-3" />
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Current link */}
      {initialSlug && !dirty && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('profileSlug.current', { defaultValue: 'Your current link:' })}{' '}
          <a
            href={`${prefix}${initialSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-teal-600 dark:text-teal-400 hover:underline"
          >
            {typeof window !== 'undefined' ? window.location.host : ''}{prefix}{initialSlug}
          </a>
        </p>
      )}
      {slugUpdatedAt && (
        <p className="mt-1 text-[11px] text-gray-400">
          {t('profileSlug.lastChanged', {
            defaultValue: 'Last changed {{date}}',
            date: new Date(slugUpdatedAt).toLocaleDateString(),
          })}
        </p>
      )}
    </div>
  );
}
