// S-19: staff notification templates in the five app languages.
// Invite / removal / resend / withdraw / rehire / career-hired notices
// used to be English server strings with raw role codes ("as a manager").
// They are now type + params: the title/body below interpolate
// {businessName}, {openingTitle} and {role}, where {role} is the
// localized display name from staffRoleName().
//
// Placeholders use the {name} convention; tNotif(type, lang, params)
// in utils/i18n.js performs the interpolation.

'use strict';

const staffRoleNames = {
  owner: {
    en: 'owner', es: 'propietario', fr: 'propriétaire', ht: 'pwopriyetè', ar: 'مالك',
  },
  manager: {
    en: 'manager', es: 'gerente', fr: 'responsable', ht: 'manadjè', ar: 'مدير',
  },
  representative: {
    en: 'representative', es: 'representante', fr: 'représentant', ht: 'reprezantan', ar: 'ممثل',
  },
  employee: {
    en: 'employee', es: 'empleado', fr: 'employé', ht: 'anplwaye', ar: 'موظف',
  },
  support_agent: {
    en: 'support agent', es: 'agente de soporte', fr: 'agent de support', ht: 'ajan sipò', ar: 'وكيل دعم',
  },
};

function staffRoleName(role, lang = 'en') {
  const entry = staffRoleNames[String(role || '').toLowerCase()];
  if (!entry) return String(role || '');
  return entry[lang] || entry.en;
}

const staffNotifications = {
  member_invite: {
    title: {
      en: 'You have been invited to join {businessName}',
      es: 'Te han invitado a unirte a {businessName}',
      fr: 'Vous avez été invité à rejoindre {businessName}',
      ht: 'Yo envite ou pou rantre nan {businessName}',
      ar: 'تمت دعوتك للانضمام إلى {businessName}',
    },
    body: {
      en: 'You have been invited to join "{businessName}" as a {role}.',
      es: 'Te han invitado a unirte a "{businessName}" como {role}.',
      fr: 'Vous avez été invité à rejoindre « {businessName} » en tant que {role}.',
      ht: 'Yo envite ou pou rantre nan "{businessName}" kòm {role}.',
      ar: 'تمت دعوتك للانضمام إلى "{businessName}" بصفة {role}.',
    },
  },
  member_invite_resent: {
    title: {
      en: 'Invitation resent from {businessName}',
      es: 'Invitación reenviada de {businessName}',
      fr: 'Invitation renvoyée par {businessName}',
      ht: 'Envitasyon voye ankò soti nan {businessName}',
      ar: 'تمت إعادة إرسال الدعوة من {businessName}',
    },
    body: {
      en: 'Your invitation to join "{businessName}" as a {role} has been resent.',
      es: 'Tu invitación para unirte a "{businessName}" como {role} ha sido reenviada.',
      fr: 'Votre invitation à rejoindre « {businessName} » en tant que {role} a été renvoyée.',
      ht: 'Envitasyon ou pou rantre nan "{businessName}" kòm {role} voye ankò.',
      ar: 'تمت إعادة إرسال دعوتك للانضمام إلى "{businessName}" بصفة {role}.',
    },
  },
  member_invite_withdrawn: {
    title: {
      en: 'Invitation withdrawn by {businessName}',
      es: 'Invitación retirada por {businessName}',
      fr: 'Invitation retirée par {businessName}',
      ht: 'Envitasyon anile pa {businessName}',
      ar: 'تم سحب الدعوة من {businessName}',
    },
    body: {
      en: 'Your invitation to join "{businessName}" as a {role} was withdrawn before you accepted it.',
      es: 'Tu invitación para unirte a "{businessName}" como {role} fue retirada antes de que la aceptaras.',
      fr: 'Votre invitation à rejoindre « {businessName} » en tant que {role} a été retirée avant que vous l’acceptiez.',
      ht: 'Envitasyon ou pou rantre nan "{businessName}" kòm {role} anile anvan ou te aksepte li.',
      ar: 'تم سحب دعوتك للانضمام إلى "{businessName}" بصفة {role} قبل قبولها.',
    },
  },
  member_removed: {
    title: {
      en: 'Removed from {businessName}',
      es: 'Eliminado de {businessName}',
      fr: 'Retiré de {businessName}',
      ht: 'Yo retire ou nan {businessName}',
      ar: 'تمت إزالتك من {businessName}',
    },
    body: {
      en: 'You have been removed as a {role} from "{businessName}".',
      es: 'Has sido eliminado como {role} de "{businessName}".',
      fr: 'Vous avez été retiré en tant que {role} de « {businessName} ».',
      ht: 'Yo retire ou kòm {role} nan "{businessName}".',
      ar: 'تمت إزالتك بصفة {role} من "{businessName}".',
    },
  },
  member_rehired: {
    title: {
      en: 'Welcome back to {businessName}',
      es: 'Bienvenido de nuevo a {businessName}',
      fr: 'Bon retour à {businessName}',
      ht: 'Byenveni tounen nan {businessName}',
      ar: 'مرحبًا بعودتك إلى {businessName}',
    },
    body: {
      en: 'You have been rehired at "{businessName}" as a {role}.',
      es: 'Has sido recontratado en "{businessName}" como {role}.',
      fr: 'Vous avez été réembauché à « {businessName} » en tant que {role}.',
      ht: 'Yo anboche ou ankò nan "{businessName}" kòm {role}.',
      ar: 'تمت إعادة توظيفك في "{businessName}" بصفة {role}.',
    },
  },
  career_hired: {
    title: {
      en: 'You were hired at {businessName}',
      es: 'Fuiste contratado en {businessName}',
      fr: 'Vous avez été embauché à {businessName}',
      ht: 'Yo anboche ou nan {businessName}',
      ar: 'تم توظيفك في {businessName}',
    },
    body: {
      en: 'Your application for {openingTitle} is now hired as {role}.',
      es: 'Tu solicitud para {openingTitle} ahora está contratada como {role}.',
      fr: 'Votre candidature pour {openingTitle} est désormais embauchée en tant que {role}.',
      ht: 'Aplikasyon ou pou {openingTitle} anboche kounye a kòm {role}.',
      ar: 'تم قبول طلبك لـ {openingTitle} بصفة {role}.',
    },
  },
  // S-19: schedule publishing and time-off decisions.
  crew_shift_published: {
    title: {
      en: 'New shifts published', es: 'Nuevos turnos publicados', fr: 'Nouveaux quarts publiés',
      ht: 'Nouvo orè travay pibliye', ar: 'تم نشر نوبات جديدة',
    },
    body: {
      en: '{count} shift(s) at {businessName}. First: {shiftLabel}.',
      es: '{count} turno(s) en {businessName}. Primero: {shiftLabel}.',
      fr: '{count} quart(s) chez {businessName}. Premier : {shiftLabel}.',
      ht: '{count} orè travay nan {businessName}. Premye a: {shiftLabel}.',
      ar: '{count} نوبة في {businessName}. الأولى: {shiftLabel}.',
    },
  },
  time_off_decided: {
    title: {
      en: 'Time-off request {decision}', es: 'Solicitud de tiempo libre {decision}', fr: 'Demande de congé {decision}',
      ht: 'Demann konje {decision}', ar: 'طلب الإجازة {decision}',
    },
    body: {
      en: 'Your request for {startDate} to {endDate} was {decision}.',
      es: 'Tu solicitud del {startDate} al {endDate} fue {decision}.',
      fr: 'Votre demande du {startDate} au {endDate} a été {decision}.',
      ht: 'Demann ou pou {startDate} rive {endDate} te {decision}.',
      ar: 'طلبك من {startDate} إلى {endDate} {decision}.',
    },
  },
};

const staffDecisionNames = {
  approved: { en: 'approved', es: 'aprobada', fr: 'approuvée', ht: 'apwouve', ar: 'تمت الموافقة عليه' },
  rejected: { en: 'declined', es: 'rechazada', fr: 'refusée', ht: 'refize', ar: 'تم رفضه' },
};
function staffDecisionName(decision, lang = 'en') {
  const entry = staffDecisionNames[String(decision || '').toLowerCase()];
  if (!entry) return String(decision || '');
  return entry[lang] || entry.en;
}

module.exports = { staffNotifications, staffRoleNames, staffRoleName, staffDecisionName };
