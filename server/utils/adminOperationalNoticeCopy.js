'use strict';
// D16: in-app note to admins when regional analytics change geo source.
const adminOperationalNotifications = {
  admin_operational_notice_region_geo_switched: {
    title: {
      en: 'Regional analytics now use GeoNames postal centres',
      es: 'La analítica regional ahora usa centros postales de GeoNames',
      fr: 'Les analyses régionales utilisent désormais les centres postaux GeoNames',
      ht: 'Analiz rejyonal yo itilize sant postal GeoNames kounye a',
      ar: 'تستخدم التحليلات الإقليمية الآن مراكز الرموز البريدية من GeoNames',
    },
    body: {
      en: 'Some regional numbers changed ({usersBefore} located before, {usersAfter} now). Open Analytics for the diff and rollback.',
      es: 'Algunas cifras regionales cambiaron ({usersBefore} ubicados antes, {usersAfter} ahora). Abre Analítica para ver la diferencia y revertir.',
      fr: 'Certains chiffres régionaux ont changé ({usersBefore} localisés avant, {usersAfter} maintenant). Ouvrez Analyses pour l’écart et le retour arrière.',
      ht: 'Kèk chif rejyonal chanje ({usersBefore} te lokalize anvan, {usersAfter} kounye a). Louvri Analiz pou wè diferans lan ak pou fè bak.',
      ar: 'تغيّرت بعض الأرقام الإقليمية ({usersBefore} محددة سابقًا، {usersAfter} الآن). افتح التحليلات لرؤية الفرق والتراجع.',
    },
  },
  admin_operational_notice_region_geo_rolled_back: {
    title: {
      en: 'Regional analytics geo source rolled back',
      es: 'Se revirtió la fuente geográfica de la analítica regional',
      fr: 'Source géographique des analyses régionales rétablie',
      ht: 'Sous jeyografik analiz rejyonal yo retounen',
      ar: 'تم التراجع عن المصدر الجغرافي للتحليلات الإقليمية',
    },
    body: {
      en: 'Regional analytics are back on {to}.',
      es: 'La analítica regional volvió a {to}.',
      fr: 'Les analyses régionales utilisent de nouveau {to}.',
      ht: 'Analiz rejyonal yo retounen sou {to}.',
      ar: 'عادت التحليلات الإقليمية إلى {to}.',
    },
  },
};
module.exports = { adminOperationalNotifications };
