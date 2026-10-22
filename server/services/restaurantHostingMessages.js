'use strict';

const messages = {
  en: { restaurant: 'the restaurant', reservation: (r, t, confirmed) => `Your reservation at ${r} ${confirmed ? 'is confirmed' : 'has been received'} for ${t}.`, waitlist: (r) => `Your table at ${r} is ready soon.`, wait: (n) => ` Estimated wait: ${n} minutes.` },
  es: { restaurant: 'el restaurante', reservation: (r, t, c) => `Tu reserva en ${r} ${c ? 'está confirmada' : 'se ha recibido'} para ${t}.`, waitlist: (r) => `Tu mesa en ${r} estará lista pronto.`, wait: (n) => ` Espera estimada: ${n} minutos.` },
  fr: { restaurant: 'le restaurant', reservation: (r, t, c) => `Votre réservation chez ${r} ${c ? 'est confirmée' : 'a été reçue'} pour ${t}.`, waitlist: (r) => `Votre table chez ${r} sera bientôt prête.`, wait: (n) => ` Attente estimée : ${n} minutes.` },
  ht: { restaurant: 'restoran an', reservation: (r, t, c) => `Rezèvasyon ou nan ${r} ${c ? 'konfime' : 'rive jwenn nou'} pou ${t}.`, waitlist: (r) => `Tab ou nan ${r} ap pare talè.`, wait: (n) => ` Tan datant estime: ${n} minit.` },
  ar: { restaurant: 'المطعم', reservation: (r, t, c) => `${c ? 'تم تأكيد' : 'تم استلام'} حجزك في ${r} لموعد ${t}.`, waitlist: (r) => `ستكون طاولتك في ${r} جاهزة قريبًا.`, wait: (n) => ` وقت الانتظار المتوقع: ${n} دقيقة.` },
};
function hostingMessage(type, language, data) {
  const locale = String(language || 'en').split(/[-_]/)[0].toLowerCase();
  const m = messages[locale] || messages.en;
  const restaurant = data.restaurant || m.restaurant;
  if (type === 'waitlist') return m.waitlist(restaurant) + (data.wait == null ? '' : m.wait(data.wait));
  let time;
  try { time = new Intl.DateTimeFormat(messages[locale] ? locale : 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone || 'UTC' }).format(new Date(data.startsAt)); }
  catch { time = new Date(data.startsAt).toISOString(); }
  return m.reservation(restaurant, time, data.confirmed);
}
module.exports = { hostingMessage };
