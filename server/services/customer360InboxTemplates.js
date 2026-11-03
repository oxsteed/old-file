"use strict";
/**
 * Customer 360 upgrade 8: reply templates in the five core languages.
 * Templates are plain text with {{firstName}} only; staff always review and
 * may edit before the explicit send action.
 */
const LANGUAGES = ["en", "es", "fr", "ht", "ar"];

const T = {
  general: {
    en: ["About your OxSteed request", "Hello {{firstName}},\n\nThank you for contacting OxSteed. We are looking into your request and will update you here as soon as we can.\n\nThe OxSteed team"],
    es: ["Sobre su solicitud en OxSteed", "Hola {{firstName}}:\n\nGracias por contactar a OxSteed. Estamos revisando su solicitud y le informaremos aquí lo antes posible.\n\nEl equipo de OxSteed"],
    fr: ["À propos de votre demande OxSteed", "Bonjour {{firstName}},\n\nMerci d’avoir contacté OxSteed. Nous examinons votre demande et vous tiendrons informé ici dès que possible.\n\nL’équipe OxSteed"],
    ht: ["Konsènan demann ou fè bay OxSteed", "Bonjou {{firstName}},\n\nMèsi paske ou kontakte OxSteed. N ap gade demann ou an epi n ap ba ou nouvèl la a pi vit posib.\n\nEkip OxSteed"],
    ar: ["بخصوص طلبك لدى OxSteed", "مرحبًا {{firstName}}،\n\nشكرًا لتواصلك مع OxSteed. نحن نراجع طلبك وسنوافيك بالمستجدات هنا في أقرب وقت ممكن.\n\nفريق OxSteed"],
  },
  verification: {
    en: ["Verify your email address", "Hello {{firstName}},\n\nTo finish setting up your account, please open the verification email we sent and select the link. If you cannot find it, check your spam folder or request a new one from the sign-in page.\n\nThe OxSteed team"],
    es: ["Verifique su correo electrónico", "Hola {{firstName}}:\n\nPara terminar de configurar su cuenta, abra el correo de verificación que le enviamos y seleccione el enlace. Si no lo encuentra, revise la carpeta de spam o solicite uno nuevo desde la página de inicio de sesión.\n\nEl equipo de OxSteed"],
    fr: ["Vérifiez votre adresse e-mail", "Bonjour {{firstName}},\n\nPour terminer la configuration de votre compte, ouvrez l’e-mail de vérification que nous vous avons envoyé et sélectionnez le lien. Si vous ne le trouvez pas, consultez vos courriers indésirables ou demandez-en un nouveau depuis la page de connexion.\n\nL’équipe OxSteed"],
    ht: ["Verifye adrès imèl ou", "Bonjou {{firstName}},\n\nPou fini konfigire kont ou, ouvri imèl verifikasyon nou voye ba ou a epi chwazi lyen an. Si ou pa jwenn li, gade nan dosye spam ou oswa mande yon lòt nan paj koneksyon an.\n\nEkip OxSteed"],
    ar: ["تحقّق من بريدك الإلكتروني", "مرحبًا {{firstName}}،\n\nلإكمال إعداد حسابك، افتح رسالة التحقق التي أرسلناها واختر الرابط. إذا لم تجدها، فتحقق من مجلد الرسائل غير المرغوب فيها أو اطلب رسالة جديدة من صفحة تسجيل الدخول.\n\nفريق OxSteed"],
  },
  payment: {
    en: ["Update about your payment", "Hello {{firstName}},\n\nWe reviewed the payment you asked about. Please check the payment details in your account; if anything still looks wrong, reply here and we will help.\n\nThe OxSteed team"],
    es: ["Novedades sobre su pago", "Hola {{firstName}}:\n\nRevisamos el pago sobre el que consultó. Consulte los detalles del pago en su cuenta; si algo sigue sin estar bien, responda aquí y le ayudaremos.\n\nEl equipo de OxSteed"],
    fr: ["Point sur votre paiement", "Bonjour {{firstName}},\n\nNous avons examiné le paiement concerné. Consultez le détail du paiement dans votre compte ; si quelque chose vous semble encore incorrect, répondez ici et nous vous aiderons.\n\nL’équipe OxSteed"],
    ht: ["Nouvèl sou peman ou", "Bonjou {{firstName}},\n\nNou egzamine peman ou te mande a. Tanpri gade detay peman an nan kont ou; si gen yon bagay ki toujou pa bon, reponn la a epi n ap ede ou.\n\nEkip OxSteed"],
    ar: ["مستجدات بشأن دفعتك", "مرحبًا {{firstName}}،\n\nراجعنا الدفعة التي استفسرت عنها. يُرجى الاطلاع على تفاصيل الدفع في حسابك، وإذا ظل هناك ما يبدو غير صحيح فرُدّ هنا وسنساعدك.\n\nفريق OxSteed"],
  },
  resolved: {
    en: ["Your request is resolved", "Hello {{firstName}},\n\nWe believe your request is now resolved. If you still need help, just reply and we will reopen it.\n\nThe OxSteed team"],
    es: ["Su solicitud está resuelta", "Hola {{firstName}}:\n\nCreemos que su solicitud ya está resuelta. Si aún necesita ayuda, responda y la volveremos a abrir.\n\nEl equipo de OxSteed"],
    fr: ["Votre demande est résolue", "Bonjour {{firstName}},\n\nNous pensons que votre demande est désormais résolue. Si vous avez encore besoin d’aide, répondez simplement et nous la rouvrirons.\n\nL’équipe OxSteed"],
    ht: ["Demann ou an rezoud", "Bonjou {{firstName}},\n\nNou kwè demann ou an rezoud kounye a. Si ou toujou bezwen èd, jis reponn epi n ap relouvri l.\n\nEkip OxSteed"],
    ar: ["تم حل طلبك", "مرحبًا {{firstName}}،\n\nنعتقد أن طلبك قد حُلّ الآن. إذا كنت لا تزال بحاجة إلى مساعدة، فما عليك سوى الرد وسنعيد فتحه.\n\nفريق OxSteed"],
  },
};

const KEYS = Object.keys(T);

function render(key, language, { firstName } = {}) {
  const tpl = T[key];
  if (!tpl) return null;
  const lang = LANGUAGES.includes(language) ? language : "en";
  const name = String(firstName || "").trim().slice(0, 60) || { en: "there", es: "", fr: "", ht: "", ar: "" }[lang];
  const fill = (s) => s.replace(/\{\{firstName\}\}/g, name).replace(/ +([,:،])/g, "$1");
  return { key, language: lang, subject: fill(tpl[lang][0]), body: fill(tpl[lang][1]) };
}

module.exports = { LANGUAGES, KEYS, render };
