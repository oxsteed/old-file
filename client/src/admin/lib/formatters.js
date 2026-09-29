import i18n from '../../i18n';

export function adminLocale(language = i18n.resolvedLanguage || i18n.language || 'en') {
  return language.split('-')[0] === 'ht' ? 'fr-HT' : language;
}

export function adminDate(value, options) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(adminLocale(), options).format(date)
    : '—';
}

export function adminDateTime(value, options = {}) {
  return adminDate(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
}

export function adminMoney(value, currency = 'USD') {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(adminLocale(), { style: 'currency', currency }).format(amount)
    : '—';
}
