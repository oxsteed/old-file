// Phase 2 - Email utility (Resend API)
// OxSteed v2

const escapeHtml = require('./escapeHtml');
const logger = require('./logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@oxsteed.com';
const FROM_NAME = process.env.FROM_NAME || 'OxSteed';
const FALLBACK_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

// Dedicated email addresses for compliance
const EMAIL_ADDRESSES = {
  noreply: 'noreply@oxsteed.com',
  privacy: 'privacy@oxsteed.com',
  security: 'security@oxsteed.com',
  legal: 'legal@oxsteed.com',
  support: 'support@oxsteed.com',
};

const EMAIL_COPY = {
  welcome: {
    en: {
      subject: 'Welcome to OxSteed!',
      lineOne: 'Your account has been created successfully.',
      lineTwo: 'You can now browse listings or post your skills on our platform.',
      footer: 'The OxSteed Team',
    },
    fr: {
      subject: 'Bienvenue sur OxSteed !',
      lineOne: 'Votre compte a été créé avec succès.',
      lineTwo: 'Vous pouvez désormais parcourir les annonces ou publier vos compétences sur notre plateforme.',
      footer: 'L’équipe OxSteed',
    },
    es: {
      subject: '¡Bienvenido a OxSteed!',
      lineOne: 'Tu cuenta se ha creado correctamente.',
      lineTwo: 'Ahora puedes buscar anuncios o publicar tus habilidades en nuestra plataforma.',
      footer: 'El equipo de OxSteed',
    },
    ht: {
      subject: 'Byenveni nan OxSteed!',
      lineOne: 'Konta ou fin kreye avèk siksè.',
      lineTwo: 'Ou kapab kounye a navige nan lis yo oswa pibliye konpetans ou sou platfòm nou an.',
      footer: 'Ekip OxSteed',
    },
    ar: {
      subject: 'مرحبًا بك في OxSteed!',
      lineOne: 'تم إنشاء حسابك بنجاح.',
      lineTwo: 'يمكنك الآن تصفح القوائم أو نشر مهاراتك على منصتنا.',
      footer: 'فريق OxSteed',
    },
  },
  otp: {
    en: {
      subject: 'Your OxSteed verification code',
      intro: 'Your verification code is:',
      expires: 'This code expires in 15 minutes.',
      note: 'If you did not request this code, you can safely ignore this email.',
      button: 'Use verification code',
    },
    fr: {
      subject: 'Votre code de vérification OxSteed',
      intro: 'Votre code de vérification est :',
      expires: 'Ce code expire dans 15 minutes.',
      note: 'Si vous n’avez pas demandé ce code, ignorez simplement cet email.',
      button: 'Utiliser le code',
    },
    es: {
      subject: 'Tu código de verificación OxSteed',
      intro: 'Tu código de verificación es:',
      expires: 'Este código caduca en 15 minutos.',
      note: 'Si no solicitaste este código, ignora este correo.',
      button: 'Usar código',
    },
    ht: {
      subject: 'Kòd verifikasyon OxSteed ou',
      intro: 'Kòd verifikasyon ou se:',
      expires: 'Kòd sa a ekspire nan 15 minit.',
      note: 'Si ou pa t mande kòd sa a, ou ka inyore imel sa a an sekirite.',
      button: 'Sèvi ak kòd la',
    },
    ar: {
      subject: 'رمز التحقق الخاص بك في OxSteed',
      intro: 'رمز التحقق الخاص بك هو:',
      expires: 'ينتهي هذا الرمز خلال 15 دقيقة.',
      note: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذا البريد بأمان.',
      button: 'استخدام الرمز',
    },
  },
  password_reset: {
    en: {
      subject: 'Reset your OxSteed password',
      intro: 'You requested to reset your password.',
      body: 'Click the button below to set a new password. This link expires in 1 hour.',
      cta: 'Reset password',
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe OxSteed',
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe.',
      body: 'Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe. Ce lien expire dans 1 heure.',
      cta: 'Réinitialiser le mot de passe',
    },
    es: {
      subject: 'Restablece tu contraseña de OxSteed',
      intro: 'Has solicitado restablecer tu contraseña.',
      body: 'Haz clic en el botón para establecer una nueva contraseña. Este enlace expira en 1 hora.',
      cta: 'Restablecer contraseña',
    },
    ht: {
      subject: 'Reyini modpas OxSteed ou',
      intro: 'Ou mande yon demann pou ou reyini modpas ou.',
      body: 'Klike bouton ki anba a pou w mete yon nouvo modpas. Lien an ekspire nan 1 èdtan.',
      cta: 'Reyini modpas',
    },
    ar: {
      subject: 'إعادة تعيين كلمة مرور OxSteed',
      intro: 'لقد طلبت إعادة تعيين كلمة المرور الخاصة بك.',
      body: 'انقر على الزر أدناه لتعيين كلمة مرور جديدة. تنتهي صلاحية هذا الرابط خلال ساعة واحدة.',
      cta: 'إعادة تعيين كلمة المرور',
    },
  },
  email_change_confirmation: {
    en: {
      subject: 'Confirm your email change',
      intro: 'Please confirm the email change requested for your OxSteed account.',
      oldEmailLabel: 'Current email',
      newEmailLabel: 'New email',
      body: 'Click the button below to confirm this change. The link expires in 1 hour.',
      cta: 'Confirm email change',
    },
    fr: {
      subject: 'Confirmez votre changement d’e-mail',
      intro: 'Veuillez confirmer le changement d’e-mail demandé pour votre compte OxSteed.',
      oldEmailLabel: 'Email actuel',
      newEmailLabel: 'Nouvel e-mail',
      body: 'Cliquez sur le bouton ci-dessous pour confirmer ce changement. هذا الرابط صالح لمدة ساعة واحدة.',
      cta: 'Confirmer le changement',
    },
    es: {
      subject: 'Confirma tu cambio de correo',
      intro: 'Confirma el cambio de correo solicitado para tu cuenta de OxSteed.',
      oldEmailLabel: 'Correo actual',
      newEmailLabel: 'Nuevo correo',
      body: 'Haz clic en el botón de abajo para confirmar este cambio. هذا الرابط صالح لمدة ساعة واحدة.',
      cta: 'Confirmar cambio',
    },
    ht: {
      subject: 'Konfime chanjman imel ou',
      intro: 'Tanpri konfime chanjman imel ou mande pou kont OxSteed ou.',
      oldEmailLabel: 'Imèl aktyèl',
      newEmailLabel: 'Nouvo imel',
      body: 'Klike bouton ki anba a pou konfime chanjman sa a. Lyen an ekspire nan 1 èdtan.',
      cta: 'Konfime chanjman an',
    },
    ar: {
      subject: 'تأكيد تغيير البريد الإلكتروني',
      intro: 'يرجى تأكيد تغيير البريد الإلكتروني المطلوب لحسابك في OxSteed.',
      oldEmailLabel: 'البريد الإلكتروني الحالي',
      newEmailLabel: 'البريد الإلكتروني الجديد',
      body: 'انقر على الزر أدناه لتأكيد هذا التغيير. تنتهي صلاحية هذا الرابط خلال ساعة واحدة.',
      cta: 'تأكيد تغيير البريد الإلكتروني',
    },
  },
  privacy_request: {
    en: {
      subject: 'Privacy request received',
      body: 'Your {{requestType}} request has been received. We will process your request within 45 days.',
      footer: 'You may contact us at privacy@oxsteed.com with your request ID.',
      closing: 'The OxSteed Privacy Team',
    },
    fr: {
      subject: 'Demande de confidentialité reçue',
      body: 'Votre demande {{requestType}} a été reçue. Nous traiterons votre demande dans les 45 jours.',
      footer: 'Vous pouvez nous contacter à privacy@oxsteed.com avec l’ID de votre demande.',
      closing: 'L’équipe Confidentialité OxSteed',
    },
    es: {
      subject: 'Solicitud de privacidad recibida',
      body: 'Hemos recibido tu solicitud de {{requestType}}. Procesaremos tu solicitud en un plazo de 45 días.',
      footer: 'Puedes contactarnos en privacy@oxsteed.com con el ID de tu solicitud.',
      closing: 'Equipo de Privacidad de OxSteed',
    },
    ht: {
      subject: 'Nou resevwa demann vi prive w',
      body: 'Nou resevwa demann {{requestType}} ou a. N ap trete demann ou an nan 45 jou.',
      footer: 'Ou ka kontakte nou nan privacy@oxsteed.com ak ID demann ou a.',
      closing: 'Ekip Konfidansyalite OxSteed',
    },
    ar: {
      subject: 'تم استلام طلب الخصوصية',
      body: 'لقد تم استلام طلب {{requestType}} الخاص بك. سنعالج طلبك خلال 45 يومًا.',
      footer: 'يمكنك التواصل معنا على privacy@oxsteed.com باستخدام معرف الطلب الخاص بك.',
      closing: 'فريق خصوصية OxSteed',
    },
  },
  security_alert: {
    en: {
      subject: 'Security alert',
      body: '{{alertType}}',
      detailsPrefix: 'Details:',
      closing: 'Security Team',
    },
    fr: {
      subject: 'Alerte de sécurité',
      body: '{{alertType}}',
      detailsPrefix: 'Détails :',
      closing: 'Équipe sécurité',
    },
    es: {
      subject: 'Alerta de seguridad',
      body: '{{alertType}}',
      detailsPrefix: 'Detalles:',
      closing: 'Equipo de seguridad',
    },
    ht: {
      subject: 'Alèt sekirite',
      body: '{{alertType}}',
      detailsPrefix: 'Detay:',
      closing: 'Ekip sekirite',
    },
    ar: {
      subject: 'تنبيه أمني',
      body: '{{alertType}}',
      detailsPrefix: 'التفاصيل:',
      closing: 'فريق الأمان',
    },
  },
};

function normalizeEmailLanguage(language) {
  const safeLang = String(language || FALLBACK_LANGUAGE).toLowerCase();
  return SUPPORTED_LANGUAGES.has(safeLang) ? safeLang : FALLBACK_LANGUAGE;
}

function templateText(template, values = {}) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function textSafe(value) {
  return (value === null || value === undefined) ? '' : String(value);
}

let emailConfigured = false;
if (RESEND_API_KEY && RESEND_API_KEY.startsWith('re_')) {
  emailConfigured = true;
} else {
  logger.warn('Resend API key not set or invalid - email features disabled');
}

async function sendEmail({ to, subject, text, html, from, fromName, idempotencyKey }) {
  if (!emailConfigured) {
    logger.debug('Email not sent - Resend not configured', { to });
    return { success: false, error: 'Email not configured' };
  }

  const senderEmail = from || FROM_EMAIL;
  const senderName = fromName || FROM_NAME;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('Resend API error', { to, status: response.status, error: data });
      return { success: false, error: data.message || 'Email send failed' };
    }
    logger.info('Email sent', { to, subject });
    return { success: true, id: data.id };
  } catch (err) {
    logger.error('Email send failed', { to, subject, error: err.message });
    return { success: false, error: err.message };
  }
}

async function sendWelcomeEmail(user, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.welcome[lang];
  const safeName = escapeHtml(textSafe(user.first_name) || textSafe(user.email));
  const subject = copy.subject || EMAIL_COPY.welcome[FALLBACK_LANGUAGE].subject;
  return sendEmail({
    to: user.email,
    subject,
    text: `Hi ${textSafe(user.first_name)}, ${copy.lineOne} ${copy.lineTwo}`,
    html: `<p>Hi <strong>${safeName}</strong>,</p><p>${copy.lineOne}</p><p>${copy.lineTwo}</p><p>- ${copy.footer}</p>`,
  });
}

async function sendOTPEmail(email, otp, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.otp[lang];
  return sendEmail({
    to: email,
    subject: copy.subject,
    text: `${copy.intro} ${escapeHtml(textSafe(otp))}. ${copy.expires} ${copy.note}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;"><h2 style="color: #2563eb;">OxSteed</h2><p>${copy.intro}</p><p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af; padding: 16px; background: #f0f4ff; border-radius: 8px; text-align: center;">${escapeHtml(textSafe(otp))}</p><p style="color: #666;">${copy.expires} ${copy.note}</p><p style="color: #6b7280; margin-top: 12px;">${copy.button}</p></div>`,
  });
}

async function sendPasswordResetEmail(email, resetInput, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  let resetUrl = '';
  let payload = {};
  let localLanguage = lang;

  if (typeof resetInput === 'object' && resetInput !== null && !Array.isArray(resetInput)) {
    resetUrl = textSafe(resetInput.actionUrl || resetInput.resetUrl || resetInput.url);
    payload = resetInput;
    localLanguage = normalizeEmailLanguage(payload.language || localLanguage);
  } else {
    resetUrl = textSafe(resetInput);
  }

  const isEmailChange = payload.type === 'email_change_confirmation';
  const copyKey = isEmailChange ? 'email_change_confirmation' : 'password_reset';
  const copy = EMAIL_COPY[copyKey][localLanguage];

  const subject = copy.subject || EMAIL_COPY[copyKey][FALLBACK_LANGUAGE].subject;
  const lines = [];
  if (copy.intro) {
    lines.push(copy.intro);
  }
  if (isEmailChange) {
    if (payload.oldEmail) lines.push(`${copy.oldEmailLabel}: ${payload.oldEmail}`);
    if (payload.newEmail) lines.push(`${copy.newEmailLabel}: ${payload.newEmail}`);
  }
  lines.push(copy.body);

  const textBody = `${lines.filter(Boolean).join(' ')} Link: ${resetUrl}`.trim();
  const ctaText = copy.cta || 'Open link';

  return sendEmail({
    to: email,
    subject,
    text: textBody,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><h2 style="color: #2563eb;">OxSteed</h2>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<a style="display:inline-block;margin-top:12px;background:#2563eb;color:#ffffff;padding:12px 16px;border-radius:8px;text-decoration:none;" href="${escapeHtml(resetUrl)}">${escapeHtml(ctaText)}</a></div>`,
  });
}

async function sendPrivacyRequestConfirmation(email, requestType, requestId, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.privacy_request[lang] || EMAIL_COPY.privacy_request[FALLBACK_LANGUAGE];
  const safeType = textSafe(requestType);
  const safeRequestId = textSafe(requestId);

  return sendEmail({
    to: email,
    from: EMAIL_ADDRESSES.privacy,
    fromName: 'OxSteed Privacy',
    subject: `${copy.subject} - ${safeType}`,
    text: templateText(copy.body, { requestType: safeType }) + ` ${copy.footer} (${safeRequestId})`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><h2 style="color: #2563eb;">OxSteed Privacy</h2><p>${templateText(copy.body, { requestType: safeType })}</p><p>Request ID: <code>${escapeHtml(safeRequestId)}</code></p><p>${copy.footer}</p><p>- ${copy.closing}</p></div>`,
  });
}

async function sendSecurityAlertEmail(email, alertType, details, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.security_alert[lang] || EMAIL_COPY.security_alert[FALLBACK_LANGUAGE];
  const safeAlertType = textSafe(alertType);
  const safeDetails = textSafe(details);

  return sendEmail({
    to: email,
    from: EMAIL_ADDRESSES.security,
    fromName: 'OxSteed Security',
    subject: `${copy.subject}: ${safeAlertType}`,
    text: `${templateText(copy.body, { alertType: safeAlertType })} ${copy.detailsPrefix} ${safeDetails}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><h2 style="color: #dc2626;">OxSteed Security Alert</h2><p><strong>${escapeHtml(safeAlertType)}</strong></p><p>${escapeHtml(safeDetails)}</p><p>${copy.detailsPrefix} ${escapeHtml(safeDetails)}</p><p>— ${copy.closing}</p></div>`,
  });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendPrivacyRequestConfirmation,
  sendSecurityAlertEmail,
  EMAIL_ADDRESSES,
};
