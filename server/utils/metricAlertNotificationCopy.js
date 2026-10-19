"use strict";

// Server-side notification copy for metric threshold alerts
// (analytics platform, Phase 2, Item 9). Mirrors the
// customer360NotificationCopy.js pattern: title/body pairs in en, es, fr,
// ht, ar, consumed by tNotif('metric_threshold_alert', lang).
//
// The body is a template; the evaluator substitutes {metric}, {operator},
// {threshold} and {value}. Metric labels are localized here so the
// notification reads correctly in the admin's preferred language without
// duplicating the client locale catalogs.

// The tNotif() entry carries ONLY the title. The body is fully composed by
// formatAlertBody() below and passed as the explicit `body` argument to
// sendNotification; if the entry carried the raw template, sendNotification
// would prepend it unsubstituted in front of the formatted body.
const metricAlertNotifications = {
  metric_threshold_alert: {
    title: {
      en: "Metric threshold alert",
      es: "Alerta de umbral de metrica",
      fr: "Alerte de seuil de metrique",
      ht: "Alet papot metrik",
      ar: "تنبيه حدّ المقياس",
    },
  },
};

const metricAlertBodyTemplates = {
  en: "{metric} crossed your alert threshold: {operator} {threshold} (current: {value}). Open My Settings to review the rule.",
  es: "{metric} superó tu umbral de alerta: {operator} {threshold} (actual: {value}). Abre Mis ajustes para revisar la regla.",
  fr: "{metric} a franchi votre seuil d’alerte : {operator} {threshold} (actuel : {value}). Ouvrez Mes réglages pour revoir la règle.",
  ht: "{metric} depase papot alèt ou: {operator} {threshold} (kounye a: {value}). Louvri Anviwonman mwen pou revize règ la.",
  ar: "تجاوز {metric} حدّ التنبيه: {operator} {threshold} (الحالي: {value}). افتح إعداداتي لمراجعة القاعدة.",
};

const metricAlertMetricLabels = {
  job_completion_rate_pct: {"en":"Job completion rate","es":"Tasa de finalización de trabajos","fr":"Taux de missions terminées","ht":"To travay ki fini","ar":"معدل إنجاز المهام"},
  dispute_rate_pct: {"en":"Disputed job rate","es":"Tasa de trabajos con disputa","fr":"Taux de missions contestées","ht":"To travay ki gen diskisyon","ar":"معدل المهام المتنازع عليها"},
  refund_rate_pct: {"en":"Refunded payment rate","es":"Tasa de pagos reembolsados","fr":"Taux de paiements remboursés","ht":"To peman ranbouse","ar":"معدل المدفوعات المستردة"},
  payout_failure_count: {"en":"Main-app payout failures","es":"Retiros fallidos de la aplicación principal","fr":"Échecs de versement de l’application principale","ht":"Retrè ki echwe nan aplikasyon prensipal la","ar":"عمليات السحب الفاشلة في التطبيق الرئيسي"},
  investor_gmv_cents: {"en":"Recorded job value","es":"Valor registrado de trabajos","fr":"Valeur enregistrée des missions","ht":"Valè travay ki anrejistre","ar":"قيمة المهام المسجلة"},
  consulting_cancel_rate_pct: {"en":"Consulting cancellation rate","es":"Tasa de cancelación de consultoría","fr":"Taux d’annulation des consultations","ht":"To anilasyon konsiltasyon","ar":"معدل إلغاء الاستشارات"},
  sla_first_response_compliance_pct: {"en":"First-response SLA compliance","es":"Cumplimiento del SLA de primera respuesta","fr":"Respect du SLA de première réponse","ht":"Respè SLA premye repons","ar":"الالتزام بمدة الاستجابة الأولى"},
  open_disputes: {
    en: "Open disputes",
    es: "Disputas abiertas",
    fr: "Litiges ouverts",
    ht: "Diskisyon ouvè",
    ar: "النزاعات المفتوحة",
  },
  platform_revenue_cents: {
    en: "Platform revenue",
    es: "Ingresos de la plataforma",
    fr: "Revenus de la plateforme",
    ht: "Revni platfòm",
    ar: "إيرادات المنصة",
  },
  investor_take_rate_pct: {
    en: "Investor take rate",
    es: "Tasa de comision para inversores",
    fr: "Taux de commission investisseur",
    ht: "To komisyon envestisè",
    ar: "نسبة عمولة المستثمر",
  },
  cancel_rate_pct: {
    en: "Cancel rate",
    es: "Tasa de cancelacion",
    fr: "Taux d’annulation",
    ht: "To anilasyon",
    ar: "معدل الإلغاء",
  },
  support_nps_index: {
    en: "Support NPS",
    es: "NPS de soporte",
    fr: "NPS du support",
    ht: "NPS sipò",
    ar: "صافي نقاط الترويج للدعم",
  },
  consulting_avg_nps: {
    en: "Consulting average NPS",
    es: "NPS promedio de consultoria",
    fr: "NPS moyen du conseil",
    ht: "NPS mwayèn konsiltasyon",
    ar: "متوسط صافي نقاط الترويج للاستشارات",
  },
  mrr_cents: {
    en: "Monthly recurring revenue",
    es: "Ingresos recurrentes mensuales",
    fr: "Revenus mensuels recurrents",
    ht: "Revni renouvlab chak mwa",
    ar: "الإيرادات الشهرية المتكررة",
  },
  escrow_held_cents: {
    en: "Escrow held",
    es: "Fondos en custodia",
    fr: "Fonds sequestres",
    ht: "Lajan nan depo garanti",
    ar: "الأموال المحتجزة في الضمان",
  },
};

const METRIC_ALERT_LANGS = ["en", "es", "fr", "ht", "ar"];

function resolveLang(lang) {
  const l = String(lang || "en").split(/[-_]/)[0].toLowerCase();
  return METRIC_ALERT_LANGS.includes(l) ? l : "en";
}

function formatAlertBody(lang, { metric, operator, threshold, value, comparison }) {
  const l = resolveLang(lang);
  const template = metricAlertBodyTemplates[l];
  let label = (metricAlertMetricLabels[metric] || {})[l]
    || metricAlertMetricLabels[metric]?.en
    || metric;
  if (comparison === 'previous_period_pct') label += ' (' + {
    en:'change from previous period',es:'cambio respecto al período anterior',fr:'variation sur la période précédente',
    ht:'chanjman depi peryòd anvan an',ar:'التغير عن الفترة السابقة',
  }[l] + ')';
  return template
    .replace("{metric}", label)
    .replace("{operator}", operator)
    .replace("{threshold}", threshold)
    .replace("{value}", value);
}

module.exports = {
  metricAlertNotifications,
  metricAlertBodyTemplates,
  metricAlertMetricLabels,
  formatAlertBody,
};
