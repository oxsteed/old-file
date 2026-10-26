// Phase 2 - Email utility (Resend API)
// OxSteed v2

const escapeHtml = require('./escapeHtml');
const logger = require('./logger');
const { renderOxSteedEmail } = require('./emailTemplate');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@oxsteed.com';
const FROM_NAME = process.env.FROM_NAME || 'OxSteed';
const FALLBACK_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th']);

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
    zh: {
      subject: '欢迎加入 OxSteed！',
      lineOne: '您的账户已成功创建。',
      lineTwo: '您现在可以在我们的平台上浏览服务列表或发布您的技能。',
      footer: 'OxSteed 团队',
    },
    ko: {
      subject: 'OxSteed에 오신 것을 환영합니다!',
      lineOne: '계정이 성공적으로 생성되었습니다.',
      lineTwo: '이제 플랫폼에서 등록된 서비스를 둘러보거나 자신의 기술을 게시할 수 있습니다.',
      footer: 'OxSteed 팀',
    },
    sw: {
      subject: 'Karibu OxSteed!',
      lineOne: 'Akaunti yako imeundwa kwa mafanikio.',
      lineTwo: 'Sasa unaweza kutazama orodha au kuchapisha ujuzi wako kwenye jukwaa letu.',
      footer: 'Timu ya OxSteed',
    },
    pt: {
      subject: 'Bem-vindo ao OxSteed!',
      lineOne: 'Sua conta foi criada com sucesso.',
      lineTwo: 'Agora você pode navegar pelos anúncios ou publicar suas habilidades em nossa plataforma.',
      footer: 'Equipe OxSteed',
    },
    hi: {
      subject: 'OxSteed में आपका स्वागत है!',
      lineOne: 'आपका खाता सफलतापूर्वक बना दिया गया है।',
      lineTwo: 'अब आप हमारे प्लेटफ़ॉर्म पर लिस्टिंग ब्राउज़ कर सकते हैं या अपने कौशल पोस्ट कर सकते हैं।',
      footer: 'OxSteed टीम',
    },
    vi: {
      subject: 'Chào mừng bạn đến với OxSteed!',
      lineOne: 'Tài khoản của bạn đã được tạo thành công.',
      lineTwo: 'Giờ đây bạn có thể duyệt danh sách hoặc đăng kỹ năng của mình trên nền tảng của chúng tôi.',
      footer: 'Đội ngũ OxSteed',
    },
    ru: {
      subject: 'Добро пожаловать в OxSteed!',
      lineOne: 'Ваш аккаунт успешно создан.',
      lineTwo: 'Теперь вы можете просматривать объявления или размещать свои навыки на нашей платформе.',
      footer: 'Команда OxSteed',
    },
    ja: {
      subject: 'OxSteedへようこそ！',
      lineOne: 'アカウントが正常に作成されました。',
      lineTwo: 'プラットフォームでサービスを探したり、あなたのスキルを投稿したりできます。',
      footer: 'OxSteedチーム',
    },
    de: {
      subject: 'Willkommen bei OxSteed!',
      lineOne: 'Ihr Konto wurde erfolgreich erstellt.',
      lineTwo: 'Sie können jetzt Anzeigen durchsuchen oder Ihre Fähigkeiten auf unserer Plattform veröffentlichen.',
      footer: 'Das OxSteed-Team',
    },
    id: {
      subject: 'Selamat datang di OxSteed!',
      lineOne: 'Akun Anda telah berhasil dibuat.',
      lineTwo: 'Anda kini dapat menjelajahi daftar layanan atau memposting keahlian Anda di platform kami.',
      footer: 'Tim OxSteed',
    },
    ur: {
      subject: 'OxSteed میں خوش آمدید!',
      lineOne: 'آپ کا اکاؤنٹ کامیابی سے بنا دیا گیا ہے۔',
      lineTwo: 'اب آپ ہمارے پلیٹ فارم پر فہرستیں دیکھ سکتے ہیں یا اپنی مہارتیں پوسٹ کر سکتے ہیں۔',
      footer: 'OxSteed ٹیم',
    },
    bn: {
      subject: 'OxSteed-এ স্বাগতম!',
      lineOne: 'আপনার অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।',
      lineTwo: 'এখন আপনি আমাদের প্ল্যাটফর্মে তালিকা ব্রাউজ করতে বা আপনার দক্ষতা পোস্ট করতে পারেন।',
      footer: 'OxSteed টিম',
    },
    it: {
      subject: 'Benvenuto su OxSteed!',
      lineOne: 'Il tuo account è stato creato con successo.',
      lineTwo: 'Ora puoi sfogliare gli annunci o pubblicare le tue competenze sulla nostra piattaforma.',
      footer: 'Il team OxSteed',
    },
    tr: {
      subject: 'OxSteed\'e hoş geldiniz!',
      lineOne: 'Hesabınız başarıyla oluşturuldu.',
      lineTwo: 'Artık platformumuzda ilanlara göz atabilir veya yeteneklerinizi yayınlayabilirsiniz.',
      footer: 'OxSteed Ekibi',
    },
    th: {
      subject: 'ยินดีต้อนรับสู่ OxSteed!',
      lineOne: 'บัญชีของคุณถูกสร้างเรียบร้อยแล้ว',
      lineTwo: 'ตอนนี้คุณสามารถดูรายการต่างๆ หรือโพสต์ทักษะของคุณบนแพลตฟอร์มของเราได้',
      footer: 'ทีม OxSteed',
    },
  },
  business_invite: {
    en: {
      subject: "You're invited to join {{business}} on OxSteed",
      eyebrow: 'TEAM INVITATION',
      intro: '{{inviter}} invited you to join {{business}} as a {{role}}.',
      body: 'Create a free OxSteed account with this email address to accept the invitation and start collaborating.',
      cta: 'Create your account',
      footer: 'The OxSteed Team',
      roleManager: 'Manager',
      roleRepresentative: 'Representative',
    },
    fr: {
      subject: 'Vous êtes invité(e) à rejoindre {{business}} sur OxSteed',
      eyebrow: 'INVITATION À REJOINDRE UNE ÉQUIPE',
      intro: '{{inviter}} vous a invité(e) à rejoindre {{business}} en tant que {{role}}.',
      body: "Créez un compte OxSteed gratuit avec cette adresse e-mail pour accepter l'invitation et commencer à collaborer.",
      cta: 'Créer votre compte',
      footer: "L'équipe OxSteed",
      roleManager: 'Gestionnaire',
      roleRepresentative: 'Représentant',
    },
    es: {
      subject: 'Te invitaron a unirte a {{business}} en OxSteed',
      eyebrow: 'INVITACIÓN DE EQUIPO',
      intro: '{{inviter}} te invitó a unirte a {{business}} como {{role}}.',
      body: 'Crea una cuenta gratuita de OxSteed con esta dirección de correo para aceptar la invitación y empezar a colaborar.',
      cta: 'Crear tu cuenta',
      footer: 'El equipo de OxSteed',
      roleManager: 'Gerente',
      roleRepresentative: 'Representante',
    },
    ht: {
      subject: 'Yo envite ou pou rantre nan {{business}} sou OxSteed',
      eyebrow: 'ENVITASYON EKIP',
      intro: '{{inviter}} envite ou pou rantre nan {{business}} kòm {{role}}.',
      body: 'Kreye yon kont OxSteed gratis ak adrès imèl sa a pou aksepte envitasyon an epi kòmanse kolabore.',
      cta: 'Kreye kont ou',
      footer: 'Ekip OxSteed',
      roleManager: 'Manadjè',
      roleRepresentative: 'Reprezantan',
    },
    ar: {
      subject: 'تمت دعوتك للانضمام إلى {{business}} على OxSteed',
      eyebrow: 'دعوة فريق',
      intro: 'دعاك {{inviter}} للانضمام إلى {{business}} بصفة {{role}}.',
      body: 'أنشئ حساب OxSteed مجانيًا باستخدام عنوان البريد الإلكتروني هذا لقبول الدعوة وبدء التعاون.',
      cta: 'أنشئ حسابك',
      footer: 'فريق OxSteed',
      roleManager: 'مدير',
      roleRepresentative: 'ممثل',
    },
    zh: {
      subject: '您受邀加入 OxSteed 上的 {{business}}',
      eyebrow: '团队邀请',
      intro: '{{inviter}} 邀请您以 {{role}} 的身份加入 {{business}}。',
      body: '使用此电子邮件地址创建免费的 OxSteed 账户，接受邀请并开始协作。',
      cta: '创建您的账户',
      footer: 'OxSteed 团队',
      roleManager: '经理',
      roleRepresentative: '代表',
    },
    ko: {
      subject: 'OxSteed에서 {{business}}에 초대되었습니다',
      eyebrow: '팀 초대',
      intro: '{{inviter}}님이 {{business}}에 {{role}}(으)로 초대하셨습니다.',
      body: '이 이메일 주소로 무료 OxSteed 계정을 만들어 초대를 수락하고 협업을 시작하세요.',
      cta: '계정 만들기',
      footer: 'OxSteed 팀',
      roleManager: '매니저',
      roleRepresentative: '담당자',
    },
    sw: {
      subject: 'Umekaribishwa kujiunga na {{business}} kwenye OxSteed',
      eyebrow: 'MUALIKO WA TIMU',
      intro: '{{inviter}} amekualika ujiunge na {{business}} kama {{role}}.',
      body: 'Unda akaunti ya bure ya OxSteed kwa anwani hii ya barua pepe ili kukubali mualiko na kuanza kushirikiana.',
      cta: 'Unda akaunti yako',
      footer: 'Timu ya OxSteed',
      roleManager: 'Meneja',
      roleRepresentative: 'Mwakilishi',
    },
    pt: {
      subject: 'Você foi convidado a participar de {{business}} no OxSteed',
      eyebrow: 'CONVITE DE EQUIPE',
      intro: '{{inviter}} convidou você a participar de {{business}} como {{role}}.',
      body: 'Crie uma conta gratuita do OxSteed com este endereço de e-mail para aceitar o convite e começar a colaborar.',
      cta: 'Criar sua conta',
      footer: 'Equipe OxSteed',
      roleManager: 'Gerente',
      roleRepresentative: 'Representante',
    },
    hi: {
      subject: 'आपको OxSteed पर {{business}} से जुड़ने के लिए आमंत्रित किया गया है',
      eyebrow: 'टीम आमंत्रण',
      intro: '{{inviter}} ने आपको {{business}} में {{role}} के रूप में जुड़ने के लिए आमंत्रित किया है।',
      body: 'आमंत्रण स्वीकार करने और सहयोग शुरू करने के लिए इस ईमेल पते से निःशुल्क OxSteed खाता बनाएं।',
      cta: 'अपना खाता बनाएं',
      footer: 'OxSteed टीम',
      roleManager: 'प्रबंधक',
      roleRepresentative: 'प्रतिनिधि',
    },
    vi: {
      subject: 'Bạn được mời tham gia {{business}} trên OxSteed',
      eyebrow: 'LỜI MỜI THAM GIA NHÓM',
      intro: '{{inviter}} đã mời bạn tham gia {{business}} với vai trò {{role}}.',
      body: 'Tạo tài khoản OxSteed miễn phí bằng địa chỉ email này để chấp nhận lời mời và bắt đầu cộng tác.',
      cta: 'Tạo tài khoản',
      footer: 'Đội ngũ OxSteed',
      roleManager: 'Quản lý',
      roleRepresentative: 'Đại diện',
    },
    ru: {
      subject: 'Вас пригласили присоединиться к {{business}} в OxSteed',
      eyebrow: 'ПРИГЛАШЕНИЕ В КОМАНДУ',
      intro: '{{inviter}} пригласил(а) вас присоединиться к {{business}} в качестве {{role}}.',
      body: 'Создайте бесплатный аккаунт OxSteed с этим адресом электронной почты, чтобы принять приглашение и начать сотрудничество.',
      cta: 'Создать аккаунт',
      footer: 'Команда OxSteed',
      roleManager: 'Менеджер',
      roleRepresentative: 'Представитель',
    },
    ja: {
      subject: 'OxSteedの{{business}}への招待が届きました',
      eyebrow: 'チーム招待',
      intro: '{{inviter}}さんが{{business}}に{{role}}として招待しました。',
      body: 'このメールアドレスで無料のOxSteedアカウントを作成し、招待を受け入れてコラボレーションを始めましょう。',
      cta: 'アカウントを作成',
      footer: 'OxSteedチーム',
      roleManager: 'マネージャー',
      roleRepresentative: '担当者',
    },
    de: {
      subject: 'Sie wurden eingeladen, {{business}} auf OxSteed beizutreten',
      eyebrow: 'TEAM-EINLADUNG',
      intro: '{{inviter}} hat Sie eingeladen, {{business}} als {{role}} beizutreten.',
      body: 'Erstellen Sie mit dieser E-Mail-Adresse ein kostenloses OxSteed-Konto, um die Einladung anzunehmen und zusammenzuarbeiten.',
      cta: 'Konto erstellen',
      footer: 'Das OxSteed-Team',
      roleManager: 'Manager',
      roleRepresentative: 'Vertreter',
    },
    id: {
      subject: 'Anda diundang untuk bergabung dengan {{business}} di OxSteed',
      eyebrow: 'UNDANGAN TIM',
      intro: '{{inviter}} mengundang Anda untuk bergabung dengan {{business}} sebagai {{role}}.',
      body: 'Buat akun OxSteed gratis dengan alamat email ini untuk menerima undangan dan mulai berkolaborasi.',
      cta: 'Buat akun Anda',
      footer: 'Tim OxSteed',
      roleManager: 'Manajer',
      roleRepresentative: 'Perwakilan',
    },
    ur: {
      subject: 'آپ کو OxSteed پر {{business}} میں شامل ہونے کی دعوت دی گئی ہے',
      eyebrow: 'ٹیم دعوت نامہ',
      intro: '{{inviter}} نے آپ کو {{business}} میں {{role}} کے طور پر شامل ہونے کی دعوت دی ہے۔',
      body: 'دعوت قبول کرنے اور تعاون شروع کرنے کے لیے اس ای میل پتے سے مفت OxSteed اکاؤنٹ بنائیں۔',
      cta: 'اپنا اکاؤنٹ بنائیں',
      footer: 'OxSteed ٹیم',
      roleManager: 'مینیجر',
      roleRepresentative: 'نمائندہ',
    },
    bn: {
      subject: 'আপনাকে OxSteed-এ {{business}}-এ যোগ দিতে আমন্ত্রণ জানানো হয়েছে',
      eyebrow: 'টিম আমন্ত্রণ',
      intro: '{{inviter}} আপনাকে {{business}}-এ {{role}} হিসেবে যোগ দিতে আমন্ত্রণ জানিয়েছেন।',
      body: 'আমন্ত্রণ গ্রহণ করতে এবং সহযোগিতা শুরু করতে এই ইমেল ঠিকানা দিয়ে একটি বিনামূল্যের OxSteed অ্যাকাউন্ট তৈরি করুন।',
      cta: 'আপনার অ্যাকাউন্ট তৈরি করুন',
      footer: 'OxSteed টিম',
      roleManager: 'ব্যবস্থাপক',
      roleRepresentative: 'প্রতিনিধি',
    },
    it: {
      subject: 'Sei stato invitato a unirti a {{business}} su OxSteed',
      eyebrow: 'INVITO DI SQUADRA',
      intro: '{{inviter}} ti ha invitato a unirti a {{business}} come {{role}}.',
      body: 'Crea un account OxSteed gratuito con questo indirizzo e-mail per accettare l’invito e iniziare a collaborare.',
      cta: 'Crea il tuo account',
      footer: 'Il team OxSteed',
      roleManager: 'Manager',
      roleRepresentative: 'Rappresentante',
    },
    tr: {
      subject: '{{business}}\'e OxSteed\'de katılmaya davet edildiniz',
      eyebrow: 'EKİP DAVETİ',
      intro: '{{inviter}} sizi {{business}} ekibine {{role}} olarak katılmaya davet etti.',
      body: 'Daveti kabul etmek ve iş birliğine başlamak için bu e-posta adresiyle ücretsiz bir OxSteed hesabı oluşturun.',
      cta: 'Hesabınızı oluşturun',
      footer: 'OxSteed Ekibi',
      roleManager: 'Yönetici',
      roleRepresentative: 'Temsilci',
    },
    th: {
      subject: 'คุณได้รับเชิญให้เข้าร่วม {{business}} บน OxSteed',
      eyebrow: 'คำเชิญเข้าร่วมทีม',
      intro: '{{inviter}} เชิญคุณเข้าร่วม {{business}} ในฐานะ {{role}}',
      body: 'สร้างบัญชี OxSteed ฟรีด้วยอีเมลนี้เพื่อยอมรับคำเชิญและเริ่มทำงานร่วมกัน',
      cta: 'สร้างบัญชีของคุณ',
      footer: 'ทีม OxSteed',
      roleManager: 'ผู้จัดการ',
      roleRepresentative: 'ผู้แทน',
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
    zh: {
      subject: '您的 OxSteed 验证码',
      intro: '您的验证码是：',
      expires: '此验证码将在 15 分钟后过期。',
      note: '如果您没有请求此验证码，可以安全地忽略此邮件。',
      button: '使用验证码',
    },
    ko: {
      subject: 'OxSteed 인증 코드',
      intro: '인증 코드는 다음과 같습니다:',
      expires: '이 코드는 15분 후에 만료됩니다.',
      note: '이 코드를 요청하지 않으셨다면 이 이메일을 무시하셔도 됩니다.',
      button: '인증 코드 사용',
    },
    sw: {
      subject: 'Msimbo wako wa uthibitisho wa OxSteed',
      intro: 'Msimbo wako wa uthibitisho ni:',
      expires: 'Msimbo huu utaisha muda baada ya dakika 15.',
      note: 'Kama hukuomba msimbo huu, unaweza kupuuza barua pepe hii kwa usalama.',
      button: 'Tumia msimbo wa uthibitisho',
    },
    pt: {
      subject: 'Seu código de verificação OxSteed',
      intro: 'Seu código de verificação é:',
      expires: 'Este código expira em 15 minutos.',
      note: 'Se você não solicitou este código, pode ignorar este e-mail com segurança.',
      button: 'Usar código de verificação',
    },
    hi: {
      subject: 'आपका OxSteed सत्यापन कोड',
      intro: 'आपका सत्यापन कोड है:',
      expires: 'यह कोड 15 मिनट में समाप्त हो जाएगा।',
      note: 'यदि आपने यह कोड अनुरोध नहीं किया है, तो आप इस ईमेल को सुरक्षित रूप से अनदेखा कर सकते हैं।',
      button: 'सत्यापन कोड उपयोग करें',
    },
    vi: {
      subject: 'Mã xác minh OxSteed của bạn',
      intro: 'Mã xác minh của bạn là:',
      expires: 'Mã này hết hạn sau 15 phút.',
      note: 'Nếu bạn không yêu cầu mã này, bạn có thể yên tâm bỏ qua email này.',
      button: 'Dùng mã xác minh',
    },
    ru: {
      subject: 'Ваш код подтверждения OxSteed',
      intro: 'Ваш код подтверждения:',
      expires: 'Срок действия кода истекает через 15 минут.',
      note: 'Если вы не запрашивали этот код, просто проигнорируйте это письмо.',
      button: 'Использовать код',
    },
    ja: {
      subject: 'OxSteed認証コード',
      intro: '認証コードは次のとおりです：',
      expires: 'このコードは15分で有効期限が切れます。',
      note: 'このコードをリクエストしていない場合は、このメールを無視して問題ありません。',
      button: '認証コードを使用',
    },
    de: {
      subject: 'Ihr OxSteed-Bestätigungscode',
      intro: 'Ihr Bestätigungscode lautet:',
      expires: 'Dieser Code läuft in 15 Minuten ab.',
      note: 'Wenn Sie diesen Code nicht angefordert haben, können Sie diese E-Mail bedenkenlos ignorieren.',
      button: 'Bestätigungscode verwenden',
    },
    id: {
      subject: 'Kode verifikasi OxSteed Anda',
      intro: 'Kode verifikasi Anda adalah:',
      expires: 'Kode ini kedaluwarsa dalam 15 menit.',
      note: 'Jika Anda tidak meminta kode ini, Anda dapat mengabaikan email ini dengan aman.',
      button: 'Gunakan kode verifikasi',
    },
    ur: {
      subject: 'آپ کا OxSteed تصدیقی کوڈ',
      intro: 'آپ کا تصدیقی کوڈ یہ ہے:',
      expires: 'یہ کوڈ 15 منٹ میں ختم ہو جائے گا۔',
      note: 'اگر آپ نے یہ کوڈ طلب نہیں کیا تو آپ اس ای میل کو محفوظ طریقے سے نظر انداز کر سکتے ہیں۔',
      button: 'تصدیقی کوڈ استعمال کریں',
    },
    bn: {
      subject: 'আপনার OxSteed যাচাইকরণ কোড',
      intro: 'আপনার যাচাইকরণ কোডটি হল:',
      expires: 'এই কোডটি 15 মিনিটের মধ্যে মেয়াদ শেষ হবে।',
      note: 'আপনি যদি এই কোডটি অনুরোধ না করে থাকেন, তাহলে নিরাপদে এই ইমেলটি উপেক্ষা করতে পারেন।',
      button: 'যাচাইকরণ কোড ব্যবহার করুন',
    },
    it: {
      subject: 'Il tuo codice di verifica OxSteed',
      intro: 'Il tuo codice di verifica è:',
      expires: 'Questo codice scade tra 15 minuti.',
      note: 'Se non hai richiesto questo codice, puoi ignorare questa e-mail in tutta sicurezza.',
      button: 'Usa il codice di verifica',
    },
    tr: {
      subject: 'OxSteed doğrulama kodunuz',
      intro: 'Doğrulama kodunuz:',
      expires: 'Bu kod 15 dakika içinde sona erer.',
      note: 'Bu kodu talep etmediyseniz, bu e-postayı güvenle yok sayabilirsiniz.',
      button: 'Doğrulama kodunu kullan',
    },
    th: {
      subject: 'รหัสยืนยัน OxSteed ของคุณ',
      intro: 'รหัสยืนยันของคุณคือ:',
      expires: 'รหัสนี้จะหมดอายุใน 15 นาที',
      note: 'หากคุณไม่ได้ขอรหัสนี้ คุณสามารถเพิกเฉยต่ออีเมลนี้ได้อย่างปลอดภัย',
      button: 'ใช้รหัสยืนยัน',
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
    zh: {
      subject: '重置您的 OxSteed 密码',
      intro: '您请求重置密码。',
      body: '点击下方按钮设置新密码。此链接将在 1 小时后过期。',
      cta: '重置密码',
    },
    ko: {
      subject: 'OxSteed 비밀번호 재설정',
      intro: '비밀번호 재설정을 요청하셨습니다.',
      body: '아래 버튼을 클릭하여 새 비밀번호를 설정하세요. 이 링크는 1시간 후에 만료됩니다.',
      cta: '비밀번호 재설정',
    },
    sw: {
      subject: 'Weka upya nenosiri lako la OxSteed',
      intro: 'Umeomba kuweka upya nenosiri lako.',
      body: 'Bofya kitufe hapa chini kuweka nenosiri jipya. Kiungo hiki kitaisha muda baada ya saa 1.',
      cta: 'Weka upya nenosiri',
    },
    pt: {
      subject: 'Redefina sua senha do OxSteed',
      intro: 'Você solicitou a redefinição da sua senha.',
      body: 'Clique no botão abaixo para definir uma nova senha. Este link expira em 1 hora.',
      cta: 'Redefinir senha',
    },
    hi: {
      subject: 'अपना OxSteed पासवर्ड रीसेट करें',
      intro: 'आपने अपना पासवर्ड रीसेट करने का अनुरोध किया है।',
      body: 'नया पासवर्ड सेट करने के लिए नीचे दिए बटन पर क्लिक करें। यह लिंक 1 घंटे में समाप्त हो जाएगा।',
      cta: 'पासवर्ड रीसेट करें',
    },
    vi: {
      subject: 'Đặt lại mật khẩu OxSteed của bạn',
      intro: 'Bạn đã yêu cầu đặt lại mật khẩu.',
      body: 'Nhấp vào nút bên dưới để đặt mật khẩu mới. Liên kết này hết hạn sau 1 giờ.',
      cta: 'Đặt lại mật khẩu',
    },
    ru: {
      subject: 'Сброс пароля OxSteed',
      intro: 'Вы запросили сброс пароля.',
      body: 'Нажмите кнопку ниже, чтобы установить новый пароль. Срок действия ссылки — 1 час.',
      cta: 'Сбросить пароль',
    },
    ja: {
      subject: 'OxSteedパスワードのリセット',
      intro: 'パスワードのリセットがリクエストされました。',
      body: '下のボタンをクリックして新しいパスワードを設定してください。このリンクは1時間で有効期限が切れます。',
      cta: 'パスワードをリセット',
    },
    de: {
      subject: 'Setzen Sie Ihr OxSteed-Passwort zurück',
      intro: 'Sie haben das Zurücksetzen Ihres Passworts angefordert.',
      body: 'Klicken Sie unten auf die Schaltfläche, um ein neues Passwort festzulegen. Dieser Link läuft in 1 Stunde ab.',
      cta: 'Passwort zurücksetzen',
    },
    id: {
      subject: 'Atur ulang kata sandi OxSteed Anda',
      intro: 'Anda meminta untuk mengatur ulang kata sandi Anda.',
      body: 'Klik tombol di bawah untuk menetapkan kata sandi baru. Tautan ini kedaluwarsa dalam 1 jam.',
      cta: 'Atur ulang kata sandi',
    },
    ur: {
      subject: 'اپنا OxSteed پاس ورڈ ری سیٹ کریں',
      intro: 'آپ نے اپنا پاس ورڈ ری سیٹ کرنے کی درخواست کی ہے۔',
      body: 'نیا پاس ورڈ سیٹ کرنے کے لیے نیچے دیے گئے بٹن پر کلک کریں۔ یہ لنک 1 گھنٹے میں ختم ہو جائے گا۔',
      cta: 'پاس ورڈ ری سیٹ کریں',
    },
    bn: {
      subject: 'আপনার OxSteed পাসওয়ার্ড রিসেট করুন',
      intro: 'আপনি আপনার পাসওয়ার্ড রিসেট করার অনুরোধ করেছেন।',
      body: 'নতুন পাসওয়ার্ড সেট করতে নিচের বোতামে ক্লিক করুন। এই লিঙ্কটি 1 ঘণ্টার মধ্যে মেয়াদ শেষ হবে।',
      cta: 'পাসওয়ার্ড রিসেট করুন',
    },
    it: {
      subject: 'Reimposta la tua password OxSteed',
      intro: 'Hai richiesto la reimpostazione della password.',
      body: 'Fai clic sul pulsante qui sotto per impostare una nuova password. Questo link scade tra 1 ora.',
      cta: 'Reimposta password',
    },
    tr: {
      subject: 'OxSteed şifrenizi sıfırlayın',
      intro: 'Şifrenizi sıfırlamayı talep ettiniz.',
      body: 'Yeni bir şifre belirlemek için aşağıdaki düğmeye tıklayın. Bu bağlantı 1 saat içinde sona erer.',
      cta: 'Şifreyi sıfırla',
    },
    th: {
      subject: 'รีเซ็ตรหัสผ่าน OxSteed ของคุณ',
      intro: 'คุณได้ขอรีเซ็ตรหัสผ่าน',
      body: 'คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง',
      cta: 'รีเซ็ตรหัสผ่าน',
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
      body: 'Cliquez sur le bouton ci-dessous pour confirmer ce changement. Ce lien expire dans 1 heure.',
      cta: 'Confirmer le changement',
    },
    es: {
      subject: 'Confirma tu cambio de correo',
      intro: 'Confirma el cambio de correo solicitado para tu cuenta de OxSteed.',
      oldEmailLabel: 'Correo actual',
      newEmailLabel: 'Nuevo correo',
      body: 'Haz clic en el botón de abajo para confirmar este cambio. Este enlace caduca en 1 hora.',
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
    zh: {
      subject: '确认您的邮箱更改',
      intro: '请确认您为 OxSteed 账户请求的邮箱更改。',
      oldEmailLabel: '当前邮箱',
      newEmailLabel: '新邮箱',
      body: '点击下方按钮确认此更改。链接将在 1 小时后过期。',
      cta: '确认邮箱更改',
    },
    ko: {
      subject: '이메일 변경 확인',
      intro: 'OxSteed 계정의 이메일 변경 요청을 확인해 주세요.',
      oldEmailLabel: '현재 이메일',
      newEmailLabel: '새 이메일',
      body: '아래 버튼을 클릭하여 변경을 확인하세요. 링크는 1시간 후에 만료됩니다.',
      cta: '이메일 변경 확인',
    },
    sw: {
      subject: 'Thibitisha mabadiliko ya barua pepe yako',
      intro: 'Tafadhali thibitisha mabadiliko ya barua pepe yaliyoombwa kwa akaunti yako ya OxSteed.',
      oldEmailLabel: 'Barua pepe ya sasa',
      newEmailLabel: 'Barua pepe mpya',
      body: 'Bofya kitufe hapa chini kuthibitisha mabadiliko haya. Kiungo kitaisha muda baada ya saa 1.',
      cta: 'Thibitisha mabadiliko ya barua pepe',
    },
    pt: {
      subject: 'Confirme sua alteração de e-mail',
      intro: 'Confirme a alteração de e-mail solicitada para sua conta OxSteed.',
      oldEmailLabel: 'E-mail atual',
      newEmailLabel: 'Novo e-mail',
      body: 'Clique no botão abaixo para confirmar esta alteração. O link expira em 1 hora.',
      cta: 'Confirmar alteração',
    },
    hi: {
      subject: 'अपने ईमेल परिवर्तन की पुष्टि करें',
      intro: 'कृपया अपने OxSteed खाते के लिए अनुरोधित ईमेल परिवर्तन की पुष्टि करें।',
      oldEmailLabel: 'वर्तमान ईमेल',
      newEmailLabel: 'नया ईमेल',
      body: 'इस परिवर्तन की पुष्टि के लिए नीचे दिए बटन पर क्लिक करें। लिंक 1 घंटे में समाप्त हो जाएगा।',
      cta: 'ईमेल परिवर्तन की पुष्टि करें',
    },
    vi: {
      subject: 'Xác nhận thay đổi email của bạn',
      intro: 'Vui lòng xác nhận yêu cầu thay đổi email cho tài khoản OxSteed của bạn.',
      oldEmailLabel: 'Email hiện tại',
      newEmailLabel: 'Email mới',
      body: 'Nhấp vào nút bên dưới để xác nhận thay đổi này. Liên kết hết hạn sau 1 giờ.',
      cta: 'Xác nhận thay đổi',
    },
    ru: {
      subject: 'Подтвердите смену адреса электронной почты',
      intro: 'Подтвердите смену адреса электронной почты, запрошенную для вашего аккаунта OxSteed.',
      oldEmailLabel: 'Текущий адрес',
      newEmailLabel: 'Новый адрес',
      body: 'Нажмите кнопку ниже, чтобы подтвердить изменение. Срок действия ссылки — 1 час.',
      cta: 'Подтвердить изменение',
    },
    ja: {
      subject: 'メールアドレス変更の確認',
      intro: 'OxSteedアカウントのメールアドレス変更リクエストを確認してください。',
      oldEmailLabel: '現在のメールアドレス',
      newEmailLabel: '新しいメールアドレス',
      body: '下のボタンをクリックして変更を確認してください。リンクは1時間で有効期限が切れます。',
      cta: '変更を確認',
    },
    de: {
      subject: 'Bestätigen Sie Ihre E-Mail-Änderung',
      intro: 'Bitte bestätigen Sie die für Ihr OxSteed-Konto angeforderte E-Mail-Änderung.',
      oldEmailLabel: 'Aktuelle E-Mail',
      newEmailLabel: 'Neue E-Mail',
      body: 'Klicken Sie unten auf die Schaltfläche, um diese Änderung zu bestätigen. Der Link läuft in 1 Stunde ab.',
      cta: 'Änderung bestätigen',
    },
    id: {
      subject: 'Konfirmasi perubahan email Anda',
      intro: 'Harap konfirmasi perubahan email yang diminta untuk akun OxSteed Anda.',
      oldEmailLabel: 'Email saat ini',
      newEmailLabel: 'Email baru',
      body: 'Klik tombol di bawah untuk mengonfirmasi perubahan ini. Tautan kedaluwarsa dalam 1 jam.',
      cta: 'Konfirmasi perubahan',
    },
    ur: {
      subject: 'اپنی ای میل تبدیلی کی تصدیق کریں',
      intro: 'براہ کرم اپنے OxSteed اکاؤنٹ کے لیے درخواست کردہ ای میل تبدیلی کی تصدیق کریں۔',
      oldEmailLabel: 'موجودہ ای میل',
      newEmailLabel: 'نئی ای میل',
      body: 'اس تبدیلی کی تصدیق کے لیے نیچے دیے گئے بٹن پر کلک کریں۔ لنک 1 گھنٹے میں ختم ہو جائے گا۔',
      cta: 'ای میل تبدیلی کی تصدیق کریں',
    },
    bn: {
      subject: 'আপনার ইমেল পরিবর্তন নিশ্চিত করুন',
      intro: 'আপনার OxSteed অ্যাকাউন্টের জন্য অনুরোধ করা ইমেল পরিবর্তনটি নিশ্চিত করুন।',
      oldEmailLabel: 'বর্তমান ইমেল',
      newEmailLabel: 'নতুন ইমেল',
      body: 'এই পরিবর্তনটি নিশ্চিত করতে নিচের বোতামে ক্লিক করুন। লিঙ্কটি 1 ঘণ্টার মধ্যে মেয়াদ শেষ হবে।',
      cta: 'ইমেল পরিবর্তন নিশ্চিত করুন',
    },
    it: {
      subject: 'Conferma la modifica dell’e-mail',
      intro: 'Conferma la modifica dell’e-mail richiesta per il tuo account OxSteed.',
      oldEmailLabel: 'E-mail attuale',
      newEmailLabel: 'Nuova e-mail',
      body: 'Fai clic sul pulsante qui sotto per confermare questa modifica. Il link scade tra 1 ora.',
      cta: 'Conferma modifica',
    },
    tr: {
      subject: 'E-posta değişikliğinizi onaylayın',
      intro: 'OxSteed hesabınız için talep edilen e-posta değişikliğini onaylayın.',
      oldEmailLabel: 'Mevcut e-posta',
      newEmailLabel: 'Yeni e-posta',
      body: 'Bu değişikliği onaylamak için aşağıdaki düğmeye tıklayın. Bağlantı 1 saat içinde sona erer.',
      cta: 'Değişikliği onayla',
    },
    th: {
      subject: 'ยืนยันการเปลี่ยนอีเมลของคุณ',
      intro: 'โปรดยืนยันคำขอเปลี่ยนอีเมลสำหรับบัญชี OxSteed ของคุณ',
      oldEmailLabel: 'อีเมลปัจจุบัน',
      newEmailLabel: 'อีเมลใหม่',
      body: 'คลิกปุ่มด้านล่างเพื่อยืนยันการเปลี่ยนแปลงนี้ ลิงก์จะหมดอายุใน 1 ชั่วโมง',
      cta: 'ยืนยันการเปลี่ยนอีเมล',
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
    zh: {
      subject: '已收到隐私请求',
      body: '我们已收到您的 {{requestType}} 请求。我们将在 45 天内处理您的请求。',
      footer: '您可以凭请求 ID 通过 privacy@oxsteed.com 联系我们。',
      closing: 'OxSteed 隐私团队',
    },
    ko: {
      subject: '개인정보 요청이 접수되었습니다',
      body: '{{requestType}} 요청이 접수되었습니다. 요청은 45일 이내에 처리됩니다.',
      footer: '요청 ID와 함께 privacy@oxsteed.com으로 문의하실 수 있습니다.',
      closing: 'OxSteed 개인정보 보호팀',
    },
    sw: {
      subject: 'Ombi la faragha limepokelewa',
      body: 'Ombi lako la {{requestType}} limepokelewa. Tutashughulikia ombi lako ndani ya siku 45.',
      footer: 'Unaweza kuwasiliana nasi kupitia privacy@oxsteed.com ukiwa na kitambulisho chako cha ombi.',
      closing: 'Timu ya Faragha ya OxSteed',
    },
    pt: {
      subject: 'Solicitação de privacidade recebida',
      body: 'Sua solicitação de {{requestType}} foi recebida. Processaremos sua solicitação em até 45 dias.',
      footer: 'Você pode entrar em contato conosco pelo e-mail privacy@oxsteed.com informando o ID da sua solicitação.',
      closing: 'Equipe de Privacidade OxSteed',
    },
    hi: {
      subject: 'गोपनीयता अनुरोध प्राप्त हुआ',
      body: 'आपका {{requestType}} अनुरोध प्राप्त हो गया है। हम 45 दिनों के भीतर आपके अनुरोध पर कार्रवाई करेंगे।',
      footer: 'आप अपनी अनुरोध आईडी के साथ privacy@oxsteed.com पर हमसे संपर्क कर सकते हैं।',
      closing: 'OxSteed गोपनीयता टीम',
    },
    vi: {
      subject: 'Đã nhận được yêu cầu về quyền riêng tư',
      body: 'Yêu cầu {{requestType}} của bạn đã được nhận. Chúng tôi sẽ xử lý yêu cầu của bạn trong vòng 45 ngày.',
      footer: 'Bạn có thể liên hệ với chúng tôi tại privacy@oxsteed.com kèm theo ID yêu cầu của bạn.',
      closing: 'Đội ngũ Bảo mật OxSteed',
    },
    ru: {
      subject: 'Запрос о конфиденциальности получен',
      body: 'Ваш запрос {{requestType}} получен. Мы обработаем его в течение 45 дней.',
      footer: 'Вы можете связаться с нами по адресу privacy@oxsteed.com, указав ID запроса.',
      closing: 'Команда конфиденциальности OxSteed',
    },
    ja: {
      subject: 'プライバシーリクエストを受け付けました',
      body: '{{requestType}}のリクエストを受け付けました。45日以内に処理いたします。',
      footer: 'リクエストIDを添えて privacy@oxsteed.com までご連絡ください。',
      closing: 'OxSteedプライバシーチーム',
    },
    de: {
      subject: 'Datenschutzanfrage erhalten',
      body: 'Ihre {{requestType}}-Anfrage ist eingegangen. Wir werden Ihre Anfrage innerhalb von 45 Tagen bearbeiten.',
      footer: 'Sie können uns unter privacy@oxsteed.com mit Ihrer Anfrage-ID kontaktieren.',
      closing: 'Das OxSteed-Datenschutzteam',
    },
    id: {
      subject: 'Permintaan privasi diterima',
      body: 'Permintaan {{requestType}} Anda telah diterima. Kami akan memproses permintaan Anda dalam waktu 45 hari.',
      footer: 'Anda dapat menghubungi kami di privacy@oxsteed.com dengan ID permintaan Anda.',
      closing: 'Tim Privasi OxSteed',
    },
    ur: {
      subject: 'پرائیویسی درخواست موصول ہو گئی',
      body: 'آپ کی {{requestType}} درخواست موصول ہو گئی ہے۔ ہم 45 دن کے اندر آپ کی درخواست پر کارروائی کریں گے۔',
      footer: 'آپ اپنی درخواست ID کے ساتھ privacy@oxsteed.com پر ہم سے رابطہ کر سکتے ہیں۔',
      closing: 'OxSteed پرائیویسی ٹیم',
    },
    bn: {
      subject: 'গোপনীয়তার অনুরোধ গৃহীত হয়েছে',
      body: 'আপনার {{requestType}} অনুরোধটি গৃহীত হয়েছে। আমরা 45 দিনের মধ্যে আপনার অনুরোধ প্রক্রিয়া করব।',
      footer: 'আপনার অনুরোধ আইডি সহ privacy@oxsteed.com-এ আমাদের সাথে যোগাযোগ করতে পারেন।',
      closing: 'OxSteed গোপনীয়তা টিম',
    },
    it: {
      subject: 'Richiesta sulla privacy ricevuta',
      body: 'La tua richiesta {{requestType}} è stata ricevuta. Elaboreremo la tua richiesta entro 45 giorni.',
      footer: 'Puoi contattarci all’indirizzo privacy@oxsteed.com indicando l’ID della richiesta.',
      closing: 'Il team Privacy di OxSteed',
    },
    tr: {
      subject: 'Gizlilik talebiniz alındı',
      body: '{{requestType}} talebiniz alındı. Talebinizi 45 gün içinde işleme alacağız.',
      footer: 'Talep kimliğinizle privacy@oxsteed.com adresinden bizimle iletişime geçebilirsiniz.',
      closing: 'OxSteed Gizlilik Ekibi',
    },
    th: {
      subject: 'ได้รับคำขอเกี่ยวกับความเป็นส่วนตัวแล้ว',
      body: 'เราได้รับคำขอ {{requestType}} ของคุณแล้ว เราจะดำเนินการคำขอของคุณภายใน 45 วัน',
      footer: 'คุณสามารถติดต่อเราได้ที่ privacy@oxsteed.com พร้อมรหัสคำขอของคุณ',
      closing: 'ทีมความเป็นส่วนตัวของ OxSteed',
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
    zh: {
      subject: '安全提醒',
      body: '{{alertType}}',
      detailsPrefix: '详情：',
      closing: '安全团队',
    },
    ko: {
      subject: '보안 알림',
      body: '{{alertType}}',
      detailsPrefix: '세부 정보:',
      closing: '보안팀',
    },
    sw: {
      subject: 'Arifa ya usalama',
      body: '{{alertType}}',
      detailsPrefix: 'Maelezo:',
      closing: 'Timu ya Usalama',
    },
    pt: {
      subject: 'Alerta de segurança',
      body: '{{alertType}}',
      detailsPrefix: 'Detalhes:',
      closing: 'Equipe de segurança',
    },
    hi: {
      subject: 'सुरक्षा चेतावनी',
      body: '{{alertType}}',
      detailsPrefix: 'विवरण:',
      closing: 'सुरक्षा टीम',
    },
    vi: {
      subject: 'Cảnh báo bảo mật',
      body: '{{alertType}}',
      detailsPrefix: 'Chi tiết:',
      closing: 'Đội ngũ Bảo mật',
    },
    ru: {
      subject: 'Предупреждение о безопасности',
      body: '{{alertType}}',
      detailsPrefix: 'Подробности:',
      closing: 'Команда безопасности',
    },
    ja: {
      subject: 'セキュリティアラート',
      body: '{{alertType}}',
      detailsPrefix: '詳細:',
      closing: 'セキュリティチーム',
    },
    de: {
      subject: 'Sicherheitswarnung',
      body: '{{alertType}}',
      detailsPrefix: 'Details:',
      closing: 'Sicherheitsteam',
    },
    id: {
      subject: 'Peringatan keamanan',
      body: '{{alertType}}',
      detailsPrefix: 'Detail:',
      closing: 'Tim Keamanan',
    },
    ur: {
      subject: 'سیکیورٹی الرٹ',
      body: '{{alertType}}',
      detailsPrefix: 'تفصیلات:',
      closing: 'سیکیورٹی ٹیم',
    },
    bn: {
      subject: 'নিরাপত্তা সতর্কতা',
      body: '{{alertType}}',
      detailsPrefix: 'বিস্তারিত:',
      closing: 'নিরাপত্তা টিম',
    },
    it: {
      subject: 'Avviso di sicurezza',
      body: '{{alertType}}',
      detailsPrefix: 'Dettagli:',
      closing: 'Team sicurezza',
    },
    tr: {
      subject: 'Güvenlik uyarısı',
      body: '{{alertType}}',
      detailsPrefix: 'Ayrıntılar:',
      closing: 'Güvenlik Ekibi',
    },
    th: {
      subject: 'การแจ้งเตือนความปลอดภัย',
      body: '{{alertType}}',
      detailsPrefix: 'รายละเอียด:',
      closing: 'ทีมรักษาความปลอดภัย',
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

async function sendEmail({ to, subject, text, html, from, fromName, idempotencyKey, headers, attachments }) {
  if (!emailConfigured) {
    // Review P3-844: in production a missing provider is an outage, not noise.
    if (process.env.NODE_ENV === 'production') {
      logger.error('Email not sent - Resend not configured', { subject: String(subject || '').slice(0, 120) });
    } else {
      logger.debug('Email not sent - Resend not configured');
    }
    return { success: false, error: 'Email not configured', code: 'email_not_configured' };
  }

  const senderEmail = from || FROM_EMAIL;
  const senderName = fromName || FROM_NAME;
  const safeSubject = String(subject || 'OxSteed').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const normalizedIdempotencyKey = idempotencyKey
    ? String(idempotencyKey).trim().slice(0, 255)
    : '';
  // Optional custom message headers (e.g. List-Unsubscribe for marketing
  // mail). Passed straight through to the Resend API.
  const customHeaders = headers && typeof headers === 'object' ? headers : null;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(normalizedIdempotencyKey ? { 'Idempotency-Key': normalizedIdempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [to],
        subject: safeSubject,
        text: String(text || ''),
        html: String(html || ''),
        ...(customHeaders ? { headers: customHeaders } : {}),
        // Careers interview invites attach an .ics file ({ filename, content: base64 }).
        ...(Array.isArray(attachments) && attachments.length ? { attachments: attachments.slice(0, 5) } : {}),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('Resend API error', {
        status: response.status,
        error: data?.message || 'Email provider rejected the request',
      });
      return { success: false, error: data.message || 'Email send failed' };
    }
    logger.info('Email sent', { subject: safeSubject });
    return { success: true, id: data.id };
  } catch (err) {
    logger.error('Email send failed', { subject: safeSubject, error: err.message });
    return { success: false, error: err.message };
  }
}

// Review P3-849: the idempotency key pins a welcome email to one (user,
// created_at) pair so a duplicated signup attempt never double-sends. A
// legitimate explicit re-send (e.g. an admin resending from the user record,
// or a "resend welcome email" action) opts out with `forceResend: true` or a
// caller-supplied `resendNonce`, which salts the key with a per-request
// nonce while keeping default duplicate-send protection intact.
async function sendWelcomeEmail(user, language = FALLBACK_LANGUAGE, options = {}) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.welcome[lang] || EMAIL_COPY.welcome[FALLBACK_LANGUAGE];
  const safeName = textSafe(user.first_name) || textSafe(user.email);
  const subject = copy.subject || EMAIL_COPY.welcome[FALLBACK_LANGUAGE].subject;
  const rendered = renderOxSteedEmail({
    language: lang,
    preheader: copy.lineOne,
    eyebrow: 'WELCOME TO OXSTEED',
    title: copy.subject.replace(/[!！]$/, ''),
    intro: `Hi ${safeName},`,
    bodyText: `${copy.lineOne}\n${copy.lineTwo}`,
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.lineOne)}</p><p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.lineTwo)}</p>`,
    cta: { label: lang === 'fr' ? 'Ouvrir OxSteed' : lang === 'es' ? 'Abrir OxSteed' : lang === 'ht' ? 'Louvri OxSteed' : lang === 'ar' ? 'فتح OxSteed' : 'Open OxSteed', url: '/dashboard' },
    footerText: copy.footer,
  });
  const createdAt = user.created_at || user.createdAt || new Date().toISOString();
  const welcomeGeneration = new Date(createdAt).toISOString();
  const forceResend = options.forceResend === true || options.resendNonce != null;
  const nonce = forceResend
    ? String(options.resendNonce || `${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}`).slice(0, 64)
    : '';
  return sendEmail({
    to: user.email,
    subject,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: user.id ? `welcome:${user.id}:${welcomeGeneration}${nonce ? `:${nonce}` : ''}` : undefined,
  });
}

// Review P2-3-F11: business invites to an email with no OxSteed account were
// silent (only in-app notifications for existing users). This sends the
// invitation email so the invitee can create an account and accept.
async function sendBusinessInviteEmail(email, options = {}) {
  const lang = normalizeEmailLanguage(options.language);
  const copy = EMAIL_COPY.business_invite[lang] || EMAIL_COPY.business_invite[FALLBACK_LANGUAGE];
  const safeEmail = textSafe(email).trim().toLowerCase();
  if (!safeEmail) return { success: false, error: 'Email is required' };
  const businessName = textSafe(options.businessName) || 'a business';
  const inviterName = textSafe(options.inviterName) || 'Someone';
  // S-19: every invitable role gets its localized name (employees and
  // support agents used to be labelled "representative").
  const roleLabel = options.role === 'manager'
    ? copy.roleManager
    : options.role === 'representative'
      ? copy.roleRepresentative
      : require('./staffNotificationTemplates').staffRoleName(options.role, lang);
  const values = { business: businessName, inviter: inviterName, role: roleLabel };
  const subject = templateText(copy.subject, values);
  const rendered = renderOxSteedEmail({
    language: lang,
    preheader: templateText(copy.intro, values),
    eyebrow: copy.eyebrow,
    title: templateText(copy.intro, values),
    intro: templateText(copy.intro, values),
    bodyText: copy.body,
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.body)}</p>`,
    cta: { label: copy.cta, url: '/join' },
    footerText: copy.footer,
  });
  const inviteId = textSafe(options.inviteId);
  return sendEmail({
    to: safeEmail,
    subject,
    text: rendered.text,
    html: rendered.html,
    // Pin one email per invite row; a re-invite creates a new row (new id)
    // so the invitee still hears about it.
    idempotencyKey: inviteId ? `business-invite:${inviteId}` : undefined,
  });
}

async function sendOTPEmail(email, otp, language = FALLBACK_LANGUAGE, guestChatOptions = null) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.otp[lang] || EMAIL_COPY.otp[FALLBACK_LANGUAGE];
  const accessCode = guestChatOptions?.accessCode ? textSafe(guestChatOptions.accessCode) : '';
  const accessCodeExpiresDays = Number(guestChatOptions?.accessCodeExpiresDays || 30);
  const guestAccessText = accessCode
    ? `Guest chat access code: ${accessCode}\nKeep this code private. It remains valid for ${accessCodeExpiresDays} days. After that, create an OxSteed account to access your chat history.`
    : '';
  const guestAccessHtml = accessCode
    ? `<p style="margin:16px 0 0;color:#334155;font-size:15px;line-height:1.6;">${escapeHtml(lang === 'fr' ? 'Vous pourrez utiliser ce code pour rouvrir cette conversation pendant 30 jours.' : lang === 'es' ? 'Puedes usar este código para volver a abrir esta conversación durante 30 días.' : lang === 'ht' ? 'Ou ka sèvi ak kòd sa a pou relouvri konvèsasyon sa a pandan 30 jou.' : lang === 'ar' ? 'يمكنك استخدام هذا الرمز لإعادة فتح هذه المحادثة لمدة 30 يومًا.' : 'Use this code to reopen this conversation for 30 days.')}</p>`
    : '';
  const rendered = renderOxSteedEmail({
    language: lang,
    preheader: copy.intro,
    eyebrow: 'SECURITY CHECK',
    title: copy.subject,
    intro: copy.intro,
    codeBlocks: [
      { label: lang === 'fr' ? 'Code de vérification' : lang === 'es' ? 'Código de verificación' : lang === 'ht' ? 'Kòd verifikasyon' : lang === 'ar' ? 'رمز التحقق' : 'Verification code', code: textSafe(otp), note: copy.expires, tone: 'blue' },
      ...(accessCode ? [{ label: lang === 'fr' ? 'Code d’accès au chat invité' : lang === 'es' ? 'Código de acceso al chat de invitado' : lang === 'ht' ? 'Kòd aksè chat envite' : lang === 'ar' ? 'رمز الوصول إلى محادثة الضيف' : 'Guest chat access code', code: accessCode, note: `Keep it private. Valid for ${accessCodeExpiresDays} days.`, tone: 'orange' }] : []),
    ],
    bodyHtml: guestAccessHtml,
    bodyText: `${copy.expires} ${copy.note}. ${guestAccessText}`,
    notice: { title: lang === 'fr' ? 'Vous n’avez pas demandé ce code ?' : lang === 'es' ? '¿No solicitaste este código?' : lang === 'ht' ? 'Ou pa t mande kòd sa a?' : lang === 'ar' ? 'لم تطلب هذا الرمز؟' : 'Didn’t request this code?', body: copy.note, tone: 'neutral' },
    footerText: copy.note,
  });
  return sendEmail({
    to: email,
    subject: copy.subject,
    text: rendered.text,
    html: rendered.html,
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
  const copy = EMAIL_COPY[copyKey][localLanguage] || EMAIL_COPY[copyKey][FALLBACK_LANGUAGE];

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
  const details = isEmailChange ? [
    payload.oldEmail ? { label: copy.oldEmailLabel, value: payload.oldEmail } : null,
    payload.newEmail ? { label: copy.newEmailLabel, value: payload.newEmail } : null,
  ].filter(Boolean) : [];
  const rendered = renderOxSteedEmail({
    language: localLanguage,
    preheader: copy.intro,
    eyebrow: isEmailChange ? 'ACCOUNT SECURITY' : 'PASSWORD RESET',
    title: copy.subject,
    intro: copy.intro,
    bodyText: copy.body,
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.body)}</p>`,
    details,
    cta: { label: ctaText, url: resetUrl },
    notice: { title: isEmailChange ? 'This link expires in 1 hour' : 'Keep your account safe', body: isEmailChange ? copy.body : 'If you did not request a password reset, you can ignore this email.', tone: 'warning' },
  });

  return sendEmail({
    to: email,
    subject,
    text: rendered.text || textBody,
    html: rendered.html,
    idempotencyKey: payload.idempotencyKey || undefined,
  });
}

async function sendPrivacyRequestConfirmation(email, requestType, requestId, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.privacy_request[lang] || EMAIL_COPY.privacy_request[FALLBACK_LANGUAGE];
  const safeType = textSafe(requestType);
  const safeRequestId = textSafe(requestId);

  const rendered = renderOxSteedEmail({
    language: lang,
    preheader: copy.subject,
    eyebrow: 'PRIVACY',
    title: copy.subject,
    bodyText: templateText(copy.body, { requestType: safeType }),
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(templateText(copy.body, { requestType: safeType }))}</p>`,
    codeBlocks: [{ label: 'Request ID', code: safeRequestId, tone: 'blue' }],
    notice: { title: copy.footer, body: copy.footer, tone: 'neutral' },
    footerText: copy.closing,
  });

  return sendEmail({
    to: email,
    from: EMAIL_ADDRESSES.privacy,
    fromName: 'OxSteed Privacy',
    subject: `${copy.subject} - ${safeType}`,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: `privacy:${safeRequestId}:${email}`,
  });
}

async function sendSecurityAlertEmail(email, alertType, details, language = FALLBACK_LANGUAGE) {
  const lang = normalizeEmailLanguage(language);
  const copy = EMAIL_COPY.security_alert[lang] || EMAIL_COPY.security_alert[FALLBACK_LANGUAGE];
  const safeAlertType = textSafe(alertType);
  const safeDetails = textSafe(details);

  const rendered = renderOxSteedEmail({
    language: lang,
    preheader: copy.subject,
    eyebrow: 'SECURITY ALERT',
    title: copy.subject,
    bodyText: `${safeAlertType}\n${copy.detailsPrefix} ${safeDetails}`,
    bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;"><strong>${escapeHtml(safeAlertType)}</strong></p><p style="margin:0;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(safeDetails)}</p>`,
    notice: { title: copy.detailsPrefix, body: safeDetails, tone: 'danger' },
    footerText: copy.closing,
  });

  return sendEmail({
    to: email,
    from: EMAIL_ADDRESSES.security,
    fromName: 'OxSteed Security',
    subject: `${copy.subject}: ${safeAlertType}`,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: `security:${email}:${safeAlertType}:${safeDetails}`.slice(0, 255),
  });
}

class EmailDeliveryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = code || 'email_delivery_failed';
  }
}

// Review P3-844: sendEmail reports failure as { success: false } and many
// callers never looked. Callers that need to know (and already catch) use this.
async function sendEmailOrThrow(options) {
  const result = await sendEmail(options);
  if (!result || result.success !== true) {
    throw new EmailDeliveryError(result?.error || 'Email send failed', result?.code);
  }
  return result;
}

async function sendEmailBatch(messages,{idempotencyKey}={}) {
  if(!Array.isArray(messages)||!messages.length||messages.length>100||!idempotencyKey)throw new Error('invalid_email_batch');
  if(!emailConfigured)throw new Error('email_not_configured');
  const response=await fetch('https://api.resend.com/emails/batch',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{Authorization:`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
    body:JSON.stringify(messages.map(m=>({...m,from:`${FROM_NAME} <${FROM_EMAIL}>`}))),
  });
  if(!response.ok)throw new Error('email_batch_unavailable');
  const result=await response.json();
  if(!Array.isArray(result.data)||result.data.length!==messages.length||result.data.some(m=>!m.id))throw new Error('email_batch_response_invalid');
  return result.data;
}
// Delivery reconciliation returns only provider identity and event, never message
// bodies (gift-card emails contain bearer value codes).
async function getEmailDeliveryStatus(id) {
  if (!emailConfigured || !/^[a-f0-9-]{36}$/i.test(String(id || ''))) return { success: false };
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { success: false };
    const data = await response.json();
    const events = new Set(['sent','delivered','delivery_delayed','bounced','complained','opened','clicked','failed','suppressed','canceled','scheduled']);
    if (data.id !== id) return { success: false };
    return { success: true, event: events.has(data.last_event) ? data.last_event : null };
  } catch { return { success: false }; }
}

module.exports = {
  getEmailDeliveryStatus,
  emailDeliveryAvailable: () => emailConfigured,
  sendEmailBatch,
  sendEmail,
  sendEmailOrThrow,
  EmailDeliveryError,
  sendWelcomeEmail,
  sendBusinessInviteEmail,
  sendOTPEmail,
  sendPasswordResetEmail,
  sendPrivacyRequestConfirmation,
  sendSecurityAlertEmail,
  EMAIL_ADDRESSES,
};
