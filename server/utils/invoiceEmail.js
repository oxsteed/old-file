// Invoice email templates and sending logic (localized: 20 languages)
const { sendEmail } = require('./email');
const logger = require('./logger');
const { maskEmail } = require('./directQuote'); // Review P3-852: PII masking for log fields
const QRCode = require('qrcode');
const escapeHtml = require('./escapeHtml');
const { renderOxSteedEmail, normalizeEmailLanguage } = require('./emailTemplate');

const EMAIL_LOCALE_TAGS = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ht: 'ht-HT',
  ar: 'ar',
  zh: 'zh-CN',
  ko: 'ko-KR',
  sw: 'sw',
  pt: 'pt-BR',
  hi: 'hi-IN',
  vi: 'vi-VN',
  ru: 'ru-RU',
  ja: 'ja-JP',
  de: 'de-DE',
  id: 'id-ID',
  ur: 'ur-PK',
  bn: 'bn-BD',
  it: 'it-IT',
  tr: 'tr-TR',
  th: 'th-TH',
};

const FALLBACK_CURRENCY = 'USD';

// Per-language copy for every user-visible string in the invoice email.
// Brand/proper names (OxSteed, Cash App, Venmo, support@oxsteed.com) stay as-is.
const INVOICE_COPY = {
  en: {
    subject: (n) => `Invoice #${n} - OxSteed Tool Rental`,
    preheader: (n) => `Invoice #${n} from OxSteed`,
    eyebrow: 'OXSTEED INVOICE',
    title: (n) => `Invoice #${n}`,
    intro: (n, date) => `Invoice #${n} was issued on ${date}.`,
    sectionBilling: 'Billing information',
    sectionRental: 'Rental details',
    sectionPayment: 'Payment instructions',
    labelTool: 'Tool',
    labelRentalPeriod: 'Rental period',
    labelDailyRate: 'Daily rate',
    labelTotal: 'Total amount',
    perDay: '/day',
    labelPaymentMethod: 'Payment method',
    labelAccount: 'Account',
    labelAmountDue: 'Amount due',
    scanQr: 'Scan the QR code to pay:',
    qrAlt: 'Payment QR code',
    noticeTitle: 'Important',
    noticeBody: 'This invoice is issued by the tool owner. OxSteed facilitates the connection but does not control rental disputes.',
    ctaLabel: 'Open secure payment page',
    footer: 'This is an automated message. For questions, contact support@oxsteed.com.',
    textHeader: 'INVOICE',
    textInvoiceNumber: 'Invoice #:',
    textDate: 'Date',
    textBillTo: 'BILL TO:',
    textFrom: 'FROM:',
    textRentalDetails: 'RENTAL DETAILS:',
    textTool: 'Tool',
    textRentalPeriod: 'Rental Period',
    textDailyRate: 'Daily Rate',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'PAYMENT METHOD:',
    textAccount: 'Account',
    textPaymentPage: 'Secure payment page',
    textQuestions: 'For questions',
    textDisclaimer: "This invoice is issued by the tool owner. OxSteed is a technology platform that facilitates rentals but does not control disputes. Contact the owner directly or resolve via your bank's chargeback process.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Bank Transfer' },
  },
  es: {
    subject: (n) => `Factura n.º ${n} - Alquiler de herramientas OxSteed`,
    preheader: (n) => `Factura n.º ${n} de OxSteed`,
    eyebrow: 'FACTURA OXSTEED',
    title: (n) => `Factura n.º ${n}`,
    intro: (n, date) => `La factura n.º ${n} se emitió el ${date}.`,
    sectionBilling: 'Información de facturación',
    sectionRental: 'Detalles del alquiler',
    sectionPayment: 'Instrucciones de pago',
    labelTool: 'Herramienta',
    labelRentalPeriod: 'Período de alquiler',
    labelDailyRate: 'Tarifa diaria',
    labelTotal: 'Importe total',
    perDay: '/día',
    labelPaymentMethod: 'Método de pago',
    labelAccount: 'Cuenta',
    labelAmountDue: 'Importe a pagar',
    scanQr: 'Escanea el código QR para pagar:',
    qrAlt: 'Código QR de pago',
    noticeTitle: 'Importante',
    noticeBody: 'Esta factura la emite el propietario de la herramienta. OxSteed facilita la conexión, pero no interviene en las disputas de alquiler.',
    ctaLabel: 'Abrir la página de pago seguro',
    footer: 'Este es un mensaje automático. Si tienes preguntas, escribe a support@oxsteed.com.',
    textHeader: 'FACTURA',
    textInvoiceNumber: 'Factura n.º:',
    textDate: 'Fecha',
    textBillTo: 'FACTURAR A:',
    textFrom: 'DE:',
    textRentalDetails: 'DETALLES DEL ALQUILER:',
    textTool: 'Herramienta',
    textRentalPeriod: 'Período de alquiler',
    textDailyRate: 'Tarifa diaria',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'MÉTODO DE PAGO:',
    textAccount: 'Cuenta',
    textPaymentPage: 'Página de pago seguro',
    textQuestions: 'Para preguntas',
    textDisclaimer: 'Esta factura la emite el propietario de la herramienta. OxSteed es una plataforma tecnológica que facilita los alquileres, pero no interviene en las disputas. Comunícate directamente con el propietario o resuélvelo mediante el proceso de devolución de tu banco.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transferencia bancaria' },
  },
  fr: {
    subject: (n) => `Facture n° ${n} - Location d'outils OxSteed`,
    preheader: (n) => `Facture n° ${n} d'OxSteed`,
    eyebrow: 'FACTURE OXSTEED',
    title: (n) => `Facture n° ${n}`,
    intro: (n, date) => `La facture n° ${n} a été émise le ${date}.`,
    sectionBilling: 'Informations de facturation',
    sectionRental: 'Détails de la location',
    sectionPayment: 'Instructions de paiement',
    labelTool: 'Outil',
    labelRentalPeriod: 'Période de location',
    labelDailyRate: 'Tarif journalier',
    labelTotal: 'Montant total',
    perDay: '/jour',
    labelPaymentMethod: 'Mode de paiement',
    labelAccount: 'Compte',
    labelAmountDue: 'Montant dû',
    scanQr: 'Scannez le code QR pour payer :',
    qrAlt: 'Code QR de paiement',
    noticeTitle: 'Important',
    noticeBody: "Cette facture est émise par le propriétaire de l'outil. OxSteed facilite la mise en relation mais ne gère pas les litiges de location.",
    ctaLabel: 'Ouvrir la page de paiement sécurisée',
    footer: 'Ceci est un message automatique. Pour toute question, écrivez à support@oxsteed.com.',
    textHeader: 'FACTURE',
    textInvoiceNumber: 'Facture n° :',
    textDate: 'Date',
    textBillTo: 'FACTURER À :',
    textFrom: 'DE :',
    textRentalDetails: 'DÉTAILS DE LA LOCATION :',
    textTool: 'Outil',
    textRentalPeriod: 'Période de location',
    textDailyRate: 'Tarif journalier',
    textTotal: 'TOTAL :',
    textPaymentMethod: 'MODE DE PAIEMENT :',
    textAccount: 'Compte',
    textPaymentPage: 'Page de paiement sécurisée',
    textQuestions: 'Pour toute question',
    textDisclaimer: "Cette facture est émise par le propriétaire de l'outil. OxSteed est une plateforme technologique qui facilite les locations, mais ne gère pas les litiges. Contactez directement le propriétaire ou passez par la procédure de contestation de votre banque.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Virement bancaire' },
  },
  ht: {
    subject: (n) => `Fakti #${n} - Lokasyon zouti OxSteed`,
    preheader: (n) => `Fakti #${n} soti nan OxSteed`,
    eyebrow: 'FAKTI OXSTEED',
    title: (n) => `Fakti #${n}`,
    intro: (n, date) => `Fakti #${n} la te bay sou ${date}.`,
    sectionBilling: 'Enfòmasyon sou fakti a',
    sectionRental: 'Detay lokasyon an',
    sectionPayment: 'Enstriksyon peman',
    labelTool: 'Zouti',
    labelRentalPeriod: 'Peryòd lokasyon',
    labelDailyRate: 'To pa jou',
    labelTotal: 'Montan total',
    perDay: '/jou',
    labelPaymentMethod: 'Metòd peman',
    labelAccount: 'Kont',
    labelAmountDue: 'Montan pou peye',
    scanQr: 'Eskane kòd QR la pou peye:',
    qrAlt: 'Kòd QR peman',
    noticeTitle: 'Enpòtan',
    noticeBody: 'Se pwopriyetè zouti a ki bay fakti sa a. OxSteed fè koneksyon an posib, men li pa jere diskisyon sou lokasyon yo.',
    ctaLabel: 'Louvri paj peman sekirize a',
    footer: 'Sa a se yon mesaj otomatik. Pou kesyon, ekri support@oxsteed.com.',
    textHeader: 'FAKTI',
    textInvoiceNumber: 'Fakti #:',
    textDate: 'Dat',
    textBillTo: 'VOYE FAKTI A BAY:',
    textFrom: 'SOTI NAN:',
    textRentalDetails: 'DETAY LOKASYON AN:',
    textTool: 'Zouti',
    textRentalPeriod: 'Peryòd lokasyon',
    textDailyRate: 'To pa jou',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'METÒD PEMAN:',
    textAccount: 'Kont',
    textPaymentPage: 'Paj peman sekirize',
    textQuestions: 'Pou kesyon',
    textDisclaimer: 'Se pwopriyetè zouti a ki bay fakti sa a. OxSteed se yon platfòm teknolojik ki fè lokasyon yo posib, men li pa jere diskisyon yo. Kontakte pwopriyetè a dirèkteman oswa rezoud pwoblèm nan atravè pwosesis chajbak bank ou a.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transfè labank' },
  },
  ar: {
    subject: (n) => `فاتورة رقم ${n} - تأجير أدوات OxSteed`,
    preheader: (n) => `فاتورة رقم ${n} من OxSteed`,
    eyebrow: 'فاتورة OXSTEED',
    title: (n) => `فاتورة رقم ${n}`,
    intro: (n, date) => `تم إصدار الفاتورة رقم ${n} بتاريخ ${date}.`,
    sectionBilling: 'معلومات الفوترة',
    sectionRental: 'تفاصيل التأجير',
    sectionPayment: 'تعليمات الدفع',
    labelTool: 'الأداة',
    labelRentalPeriod: 'فترة التأجير',
    labelDailyRate: 'السعر اليومي',
    labelTotal: 'المبلغ الإجمالي',
    perDay: '/يوم',
    labelPaymentMethod: 'طريقة الدفع',
    labelAccount: 'الحساب',
    labelAmountDue: 'المبلغ المستحق',
    scanQr: 'امسح رمز QR للدفع:',
    qrAlt: 'رمز QR للدفع',
    noticeTitle: 'مهم',
    noticeBody: 'هذه الفاتورة صادرة عن مالك الأداة. تسهل OxSteed التواصل، لكنها لا تتحكم في نزاعات التأجير.',
    ctaLabel: 'فتح صفحة الدفع الآمنة',
    footer: 'هذه رسالة تلقائية. للأسئلة، تواصل مع support@oxsteed.com.',
    textHeader: 'فاتورة',
    textInvoiceNumber: 'رقم الفاتورة:',
    textDate: 'التاريخ',
    textBillTo: 'فوترة إلى:',
    textFrom: 'من:',
    textRentalDetails: 'تفاصيل التأجير:',
    textTool: 'الأداة',
    textRentalPeriod: 'فترة التأجير',
    textDailyRate: 'السعر اليومي',
    textTotal: 'الإجمالي:',
    textPaymentMethod: 'طريقة الدفع:',
    textAccount: 'الحساب',
    textPaymentPage: 'صفحة الدفع الآمنة',
    textQuestions: 'للأسئلة',
    textDisclaimer: 'هذه الفاتورة صادرة عن مالك الأداة. OxSteed منصة تقنية تسهل عمليات التأجير، لكنها لا تتحكم في النزاعات. تواصل مع المالك مباشرة أو تابع عملية الاعتراض عبر مصرفك.',
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'تحويل بنكي' },
  },
  zh: {
    subject: (n) => `发票 #${n} - OxSteed 工具租赁`,
    preheader: (n) => `来自 OxSteed 的发票 #${n}`,
    eyebrow: 'OXSTEED 发票',
    title: (n) => `发票 #${n}`,
    intro: (n, date) => `发票 #${n} 于 ${date} 开具。`,
    sectionBilling: '账单信息',
    sectionRental: '租赁详情',
    sectionPayment: '付款说明',
    labelTool: '工具',
    labelRentalPeriod: '租赁期',
    labelDailyRate: '日租金',
    labelTotal: '总金额',
    perDay: '/天',
    labelPaymentMethod: '付款方式',
    labelAccount: '账户',
    labelAmountDue: '应付金额',
    scanQr: '扫描二维码付款：',
    qrAlt: '付款二维码',
    noticeTitle: '重要提示',
    noticeBody: '本发票由工具所有者开具。OxSteed 仅提供对接服务，不处理租赁纠纷。',
    ctaLabel: '打开安全付款页面',
    footer: '此为自动发送的消息。如有疑问，请联系 support@oxsteed.com。',
    textHeader: '发票',
    textInvoiceNumber: '发票编号：',
    textDate: '日期',
    textBillTo: '账单收件人：',
    textFrom: '来自：',
    textRentalDetails: '租赁详情：',
    textTool: '工具',
    textRentalPeriod: '租赁期',
    textDailyRate: '日租金',
    textTotal: '总计：',
    textPaymentMethod: '付款方式：',
    textAccount: '账户',
    textPaymentPage: '安全付款页面',
    textQuestions: '如有疑问',
    textDisclaimer: "本发票由工具所有者开具。OxSteed 是一个促成租赁的技术平台，不处理纠纷。请直接联系所有者，或通过银行的拒付流程解决。",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: '银行转账' },
  },
  ko: {
    subject: (n) => `청구서 #${n} - OxSteed 공구 대여`,
    preheader: (n) => `OxSteed에서 보낸 청구서 #${n}`,
    eyebrow: 'OXSTEED 청구서',
    title: (n) => `청구서 #${n}`,
    intro: (n, date) => `청구서 #${n}이(가) ${date}에 발행되었습니다.`,
    sectionBilling: '청구 정보',
    sectionRental: '대여 상세 정보',
    sectionPayment: '결제 안내',
    labelTool: '공구',
    labelRentalPeriod: '대여 기간',
    labelDailyRate: '일일 요금',
    labelTotal: '총 금액',
    perDay: '/일',
    labelPaymentMethod: '결제 수단',
    labelAccount: '계정',
    labelAmountDue: '결제 예정 금액',
    scanQr: '결제하려면 QR 코드를 스캔하세요:',
    qrAlt: '결제 QR 코드',
    noticeTitle: '중요 안내',
    noticeBody: '이 청구서는 공구 소유자가 발행합니다. OxSteed는 연결을 돕지만 대여 분쟁은 처리하지 않습니다.',
    ctaLabel: '안전 결제 페이지 열기',
    footer: '이 메시지는 자동 발송되었습니다. 문의사항은 support@oxsteed.com으로 연락하세요.',
    textHeader: '청구서',
    textInvoiceNumber: '청구서 번호:',
    textDate: '날짜',
    textBillTo: '청구 대상:',
    textFrom: '발신:',
    textRentalDetails: '대여 상세 정보:',
    textTool: '공구',
    textRentalPeriod: '대여 기간',
    textDailyRate: '일일 요금',
    textTotal: '합계:',
    textPaymentMethod: '결제 수단:',
    textAccount: '계정',
    textPaymentPage: '안전 결제 페이지',
    textQuestions: '문의사항',
    textDisclaimer: "이 청구서는 공구 소유자가 발행합니다. OxSteed는 대여를 연결하는 기술 플랫폼이며 분쟁은 처리하지 않습니다. 소유자에게 직접 연락하거나 은행의 차지백 절차를 통해 해결하세요.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: '은행 이체' },
  },
  sw: {
    subject: (n) => `Ankara #${n} - Kukodisha Zana za OxSteed`,
    preheader: (n) => `Ankara #${n} kutoka OxSteed`,
    eyebrow: 'ANKARA YA OXSTEED',
    title: (n) => `Ankara #${n}`,
    intro: (n, date) => `Ankara #${n} ilitolewa tarehe ${date}.`,
    sectionBilling: 'Taarifa za malipo',
    sectionRental: 'Maelezo ya ukodishaji',
    sectionPayment: 'Maelekezo ya malipo',
    labelTool: 'Chombo',
    labelRentalPeriod: 'Kipindi cha ukodishaji',
    labelDailyRate: 'Kiwango cha kila siku',
    labelTotal: 'Jumla ya kiasi',
    perDay: '/siku',
    labelPaymentMethod: 'Njia ya malipo',
    labelAccount: 'Akaunti',
    labelAmountDue: 'Kiasi kinachodaiwa',
    scanQr: 'Changanua msimbo wa QR kulipa:',
    qrAlt: 'Msimbo wa QR wa malipo',
    noticeTitle: 'Muhimu',
    noticeBody: 'Ankara hii imetolewa na mmiliki wa chombo. OxSteed inawezesha muunganisho lakini haishughulikii migogoro ya ukodishaji.',
    ctaLabel: 'Fungua ukurasa salama wa malipo',
    footer: 'Huu ni ujumbe wa kiotomatiki. Kwa maswali, wasiliana na support@oxsteed.com.',
    textHeader: 'ANKARA',
    textInvoiceNumber: 'Ankara #:',
    textDate: 'Tarehe',
    textBillTo: 'MALIPO KWA:',
    textFrom: 'KUTOKA KWA:',
    textRentalDetails: 'MAELEZO YA UKODISHAJI:',
    textTool: 'Chombo',
    textRentalPeriod: 'Kipindi cha Ukodishaji',
    textDailyRate: 'Kiwango cha Kila Siku',
    textTotal: 'JUMLA:',
    textPaymentMethod: 'NJIA YA MALIPO:',
    textAccount: 'Akaunti',
    textPaymentPage: 'Ukurasa salama wa malipo',
    textQuestions: 'Kwa maswali',
    textDisclaimer: "Ankara hii imetolewa na mmiliki wa chombo. OxSteed ni jukwaa la teknolojia linalowezesha ukodishaji lakini halishughulikii migogoro. Wasiliana na mmiliki moja kwa moja au tatua kupitia mchakato wa kurejesha malipo wa benki yako.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Uhamisho wa Benki' },
  },
  pt: {
    subject: (n) => `Fatura nº ${n} - Aluguel de ferramentas OxSteed`,
    preheader: (n) => `Fatura nº ${n} da OxSteed`,
    eyebrow: 'FATURA OXSTEED',
    title: (n) => `Fatura nº ${n}`,
    intro: (n, date) => `A fatura nº ${n} foi emitida em ${date}.`,
    sectionBilling: 'Informações de cobrança',
    sectionRental: 'Detalhes do aluguel',
    sectionPayment: 'Instruções de pagamento',
    labelTool: 'Ferramenta',
    labelRentalPeriod: 'Período de aluguel',
    labelDailyRate: 'Diária',
    labelTotal: 'Valor total',
    perDay: '/dia',
    labelPaymentMethod: 'Método de pagamento',
    labelAccount: 'Conta',
    labelAmountDue: 'Valor a pagar',
    scanQr: 'Escaneie o código QR para pagar:',
    qrAlt: 'Código QR de pagamento',
    noticeTitle: 'Importante',
    noticeBody: 'Esta fatura é emitida pelo proprietário da ferramenta. A OxSteed facilita a conexão, mas não gerencia disputas de aluguel.',
    ctaLabel: 'Abrir página de pagamento segura',
    footer: 'Esta é uma mensagem automática. Para dúvidas, entre em contato com support@oxsteed.com.',
    textHeader: 'FATURA',
    textInvoiceNumber: 'Fatura nº:',
    textDate: 'Data',
    textBillTo: 'COBRAR DE:',
    textFrom: 'DE:',
    textRentalDetails: 'DETALHES DO ALUGUEL:',
    textTool: 'Ferramenta',
    textRentalPeriod: 'Período de Aluguel',
    textDailyRate: 'Diária',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'MÉTODO DE PAGAMENTO:',
    textAccount: 'Conta',
    textPaymentPage: 'Página de pagamento segura',
    textQuestions: 'Para dúvidas',
    textDisclaimer: "Esta fatura é emitida pelo proprietário da ferramenta. A OxSteed é uma plataforma de tecnologia que facilita aluguéis, mas não gerencia disputas. Entre em contato diretamente com o proprietário ou resolva pelo processo de estorno do seu banco.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transferência Bancária' },
  },
  hi: {
    subject: (n) => `चालान #${n} - OxSteed टूल रेंटल`,
    preheader: (n) => `OxSteed से चालान #${n}`,
    eyebrow: 'OXSTEED चालान',
    title: (n) => `चालान #${n}`,
    intro: (n, date) => `चालान #${n} ${date} को जारी किया गया।`,
    sectionBilling: 'बिलिंग जानकारी',
    sectionRental: 'किराए का विवरण',
    sectionPayment: 'भुगतान निर्देश',
    labelTool: 'उपकरण',
    labelRentalPeriod: 'किराए की अवधि',
    labelDailyRate: 'दैनिक दर',
    labelTotal: 'कुल राशि',
    perDay: '/दिन',
    labelPaymentMethod: 'भुगतान विधि',
    labelAccount: 'खाता',
    labelAmountDue: 'देय राशि',
    scanQr: 'भुगतान के लिए QR कोड स्कैन करें:',
    qrAlt: 'भुगतान QR कोड',
    noticeTitle: 'महत्वपूर्ण',
    noticeBody: 'यह चालान उपकरण के मालिक द्वारा जारी किया जाता है। OxSteed संपर्क सुविधाजनक बनाता है लेकिन किराए के विवादों को नियंत्रित नहीं करता।',
    ctaLabel: 'सुरक्षित भुगतान पृष्ठ खोलें',
    footer: 'यह एक स्वचालित संदेश है। प्रश्नों के लिए support@oxsteed.com से संपर्क करें।',
    textHeader: 'चालान',
    textInvoiceNumber: 'चालान #:',
    textDate: 'तारीख',
    textBillTo: 'बिल प्राप्तकर्ता:',
    textFrom: 'प्रेषक:',
    textRentalDetails: 'किराए का विवरण:',
    textTool: 'उपकरण',
    textRentalPeriod: 'किराए की अवधि',
    textDailyRate: 'दैनिक दर',
    textTotal: 'कुल:',
    textPaymentMethod: 'भुगतान विधि:',
    textAccount: 'खाता',
    textPaymentPage: 'सुरक्षित भुगतान पृष्ठ',
    textQuestions: 'प्रश्नों के लिए',
    textDisclaimer: "यह चालान उपकरण के मालिक द्वारा जारी किया जाता है। OxSteed एक तकनीकी मंच है जो किराए को सुविधाजनक बनाता है लेकिन विवादों को नियंत्रित नहीं करता। सीधे मालिक से संपर्क करें या अपने बैंक की चार्जबैक प्रक्रिया के माध्यम से समाधान करें।",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'बैंक ट्रांसफर' },
  },
  vi: {
    subject: (n) => `Hóa đơn #${n} - Cho thuê dụng cụ OxSteed`,
    preheader: (n) => `Hóa đơn #${n} từ OxSteed`,
    eyebrow: 'HÓA ĐƠN OXSTEED',
    title: (n) => `Hóa đơn #${n}`,
    intro: (n, date) => `Hóa đơn #${n} được phát hành vào ngày ${date}.`,
    sectionBilling: 'Thông tin thanh toán',
    sectionRental: 'Chi tiết thuê',
    sectionPayment: 'Hướng dẫn thanh toán',
    labelTool: 'Dụng cụ',
    labelRentalPeriod: 'Thời gian thuê',
    labelDailyRate: 'Giá thuê theo ngày',
    labelTotal: 'Tổng số tiền',
    perDay: '/ngày',
    labelPaymentMethod: 'Phương thức thanh toán',
    labelAccount: 'Tài khoản',
    labelAmountDue: 'Số tiền phải trả',
    scanQr: 'Quét mã QR để thanh toán:',
    qrAlt: 'Mã QR thanh toán',
    noticeTitle: 'Quan trọng',
    noticeBody: 'Hóa đơn này do chủ sở hữu dụng cụ phát hành. OxSteed hỗ trợ kết nối nhưng không giải quyết tranh chấp cho thuê.',
    ctaLabel: 'Mở trang thanh toán an toàn',
    footer: 'Đây là tin nhắn tự động. Nếu có thắc mắc, vui lòng liên hệ support@oxsteed.com.',
    textHeader: 'HÓA ĐƠN',
    textInvoiceNumber: 'Hóa đơn số:',
    textDate: 'Ngày',
    textBillTo: 'THANH TOÁN CHO:',
    textFrom: 'TỪ:',
    textRentalDetails: 'CHI TIẾT THUÊ:',
    textTool: 'Dụng cụ',
    textRentalPeriod: 'Thời Gian Thuê',
    textDailyRate: 'Giá Thuê Theo Ngày',
    textTotal: 'TỔNG CỘNG:',
    textPaymentMethod: 'PHƯƠNG THỨC THANH TOÁN:',
    textAccount: 'Tài khoản',
    textPaymentPage: 'Trang thanh toán an toàn',
    textQuestions: 'Nếu có thắc mắc',
    textDisclaimer: "Hóa đơn này do chủ sở hữu dụng cụ phát hành. OxSteed là nền tảng công nghệ hỗ trợ cho thuê nhưng không giải quyết tranh chấp. Vui lòng liên hệ trực tiếp với chủ sở hữu hoặc giải quyết qua quy trình khiếu nại của ngân hàng.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Chuyển Khoản Ngân Hàng' },
  },
  ru: {
    subject: (n) => `Счёт #${n} — Аренда инструментов OxSteed`,
    preheader: (n) => `Счёт #${n} от OxSteed`,
    eyebrow: 'СЧЁТ OXSTEED',
    title: (n) => `Счёт #${n}`,
    intro: (n, date) => `Счёт #${n} выставлен ${date}.`,
    sectionBilling: 'Платёжная информация',
    sectionRental: 'Детали аренды',
    sectionPayment: 'Инструкции по оплате',
    labelTool: 'Инструмент',
    labelRentalPeriod: 'Период аренды',
    labelDailyRate: 'Дневной тариф',
    labelTotal: 'Итоговая сумма',
    perDay: '/день',
    labelPaymentMethod: 'Способ оплаты',
    labelAccount: 'Счёт',
    labelAmountDue: 'Сумма к оплате',
    scanQr: 'Отсканируйте QR-код для оплаты:',
    qrAlt: 'QR-код для оплаты',
    noticeTitle: 'Важно',
    noticeBody: 'Этот счёт выставлен владельцем инструмента. OxSteed обеспечивает связь, но не разрешает споры по аренде.',
    ctaLabel: 'Открыть защищённую страницу оплаты',
    footer: 'Это автоматическое сообщение. По вопросам обращайтесь: support@oxsteed.com.',
    textHeader: 'СЧЁТ',
    textInvoiceNumber: 'Счёт №:',
    textDate: 'Дата',
    textBillTo: 'ПЛАТЕЛЬЩИК:',
    textFrom: 'ОТ:',
    textRentalDetails: 'ДЕТАЛИ АРЕНДЫ:',
    textTool: 'Инструмент',
    textRentalPeriod: 'Период Аренды',
    textDailyRate: 'Дневной Тариф',
    textTotal: 'ИТОГО:',
    textPaymentMethod: 'СПОСОБ ОПЛАТЫ:',
    textAccount: 'Счёт',
    textPaymentPage: 'Защищённая страница оплаты',
    textQuestions: 'По вопросам',
    textDisclaimer: "Этот счёт выставлен владельцем инструмента. OxSteed — технологическая платформа, которая помогает с арендой, но не разрешает споры. Свяжитесь с владельцем напрямую или решите вопрос через процедуру возврата платежа вашего банка.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Банковский Перевод' },
  },
  ja: {
    subject: (n) => `請求書 #${n} - OxSteed ツールレンタル`,
    preheader: (n) => `OxSteed からの請求書 #${n}`,
    eyebrow: 'OXSTEED 請求書',
    title: (n) => `請求書 #${n}`,
    intro: (n, date) => `請求書 #${n} は ${date} に発行されました。`,
    sectionBilling: '請求情報',
    sectionRental: 'レンタル詳細',
    sectionPayment: 'お支払い方法',
    labelTool: 'ツール',
    labelRentalPeriod: 'レンタル期間',
    labelDailyRate: '1日あたりの料金',
    labelTotal: '合計金額',
    perDay: '/日',
    labelPaymentMethod: 'お支払い方法',
    labelAccount: 'アカウント',
    labelAmountDue: 'お支払い金額',
    scanQr: 'QRコードをスキャンしてお支払いください:',
    qrAlt: '支払い用QRコード',
    noticeTitle: '重要',
    noticeBody: 'この請求書はツールの所有者によって発行されます。OxSteed はマッチングを支援しますが、レンタルに関する紛争は取り扱いません。',
    ctaLabel: '安全なお支払いページを開く',
    footer: 'このメールは自動送信です。ご質問は support@oxsteed.com までご連絡ください。',
    textHeader: '請求書',
    textInvoiceNumber: '請求書番号:',
    textDate: '日付',
    textBillTo: '請求先:',
    textFrom: '差出人:',
    textRentalDetails: 'レンタル詳細:',
    textTool: 'ツール',
    textRentalPeriod: 'レンタル期間',
    textDailyRate: '1日あたりの料金',
    textTotal: '合計:',
    textPaymentMethod: 'お支払い方法:',
    textAccount: 'アカウント',
    textPaymentPage: '安全なお支払いページ',
    textQuestions: 'ご質問はこちら',
    textDisclaimer: "この請求書はツールの所有者によって発行されます。OxSteed はレンタルを支援する技術プラットフォームであり、紛争は取り扱いません。所有者に直接ご連絡いただくか、銀行のチャージバック手続きで解決してください。",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: '銀行振込' },
  },
  de: {
    subject: (n) => `Rechnung #${n} - OxSteed Werkzeugvermietung`,
    preheader: (n) => `Rechnung #${n} von OxSteed`,
    eyebrow: 'OXSTEED-RECHNUNG',
    title: (n) => `Rechnung #${n}`,
    intro: (n, date) => `Die Rechnung #${n} wurde am ${date} ausgestellt.`,
    sectionBilling: 'Rechnungsinformationen',
    sectionRental: 'Mietdetails',
    sectionPayment: 'Zahlungsanweisungen',
    labelTool: 'Werkzeug',
    labelRentalPeriod: 'Mietzeitraum',
    labelDailyRate: 'Tagessatz',
    labelTotal: 'Gesamtbetrag',
    perDay: '/Tag',
    labelPaymentMethod: 'Zahlungsmethode',
    labelAccount: 'Konto',
    labelAmountDue: 'Fälliger Betrag',
    scanQr: 'Scannen Sie den QR-Code zum Bezahlen:',
    qrAlt: 'QR-Code zur Zahlung',
    noticeTitle: 'Wichtig',
    noticeBody: 'Diese Rechnung wird vom Werkzeugbesitzer ausgestellt. OxSteed vermittelt die Verbindung, ist aber nicht für Mietstreitigkeiten zuständig.',
    ctaLabel: 'Sichere Zahlungsseite öffnen',
    footer: 'Dies ist eine automatische Nachricht. Bei Fragen wenden Sie sich an support@oxsteed.com.',
    textHeader: 'RECHNUNG',
    textInvoiceNumber: 'Rechnung Nr.:',
    textDate: 'Datum',
    textBillTo: 'RECHNUNG AN:',
    textFrom: 'VON:',
    textRentalDetails: 'MIETDETAILS:',
    textTool: 'Werkzeug',
    textRentalPeriod: 'Mietzeitraum',
    textDailyRate: 'Tagessatz',
    textTotal: 'GESAMT:',
    textPaymentMethod: 'ZAHLUNGSMETHODE:',
    textAccount: 'Konto',
    textPaymentPage: 'Sichere Zahlungsseite',
    textQuestions: 'Bei Fragen',
    textDisclaimer: "Diese Rechnung wird vom Werkzeugbesitzer ausgestellt. OxSteed ist eine Technologieplattform, die Vermietungen vermittelt, aber keine Streitigkeiten regelt. Wenden Sie sich direkt an den Besitzer oder klären Sie dies über das Rückbuchungsverfahren Ihrer Bank.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Banküberweisung' },
  },
  id: {
    subject: (n) => `Faktur #${n} - Sewa Alat OxSteed`,
    preheader: (n) => `Faktur #${n} dari OxSteed`,
    eyebrow: 'FAKTUR OXSTEED',
    title: (n) => `Faktur #${n}`,
    intro: (n, date) => `Faktur #${n} diterbitkan pada ${date}.`,
    sectionBilling: 'Informasi penagihan',
    sectionRental: 'Detail sewa',
    sectionPayment: 'Instruksi pembayaran',
    labelTool: 'Alat',
    labelRentalPeriod: 'Periode sewa',
    labelDailyRate: 'Tarif harian',
    labelTotal: 'Jumlah total',
    perDay: '/hari',
    labelPaymentMethod: 'Metode pembayaran',
    labelAccount: 'Akun',
    labelAmountDue: 'Jumlah yang harus dibayar',
    scanQr: 'Pindai kode QR untuk membayar:',
    qrAlt: 'Kode QR pembayaran',
    noticeTitle: 'Penting',
    noticeBody: 'Faktur ini diterbitkan oleh pemilik alat. OxSteed memfasilitasi koneksi tetapi tidak menangani sengketa sewa.',
    ctaLabel: 'Buka halaman pembayaran yang aman',
    footer: 'Ini adalah pesan otomatis. Untuk pertanyaan, hubungi support@oxsteed.com.',
    textHeader: 'FAKTUR',
    textInvoiceNumber: 'Faktur #:',
    textDate: 'Tanggal',
    textBillTo: 'DITAGIHKAN KEPADA:',
    textFrom: 'DARI:',
    textRentalDetails: 'DETAIL SEWA:',
    textTool: 'Alat',
    textRentalPeriod: 'Periode Sewa',
    textDailyRate: 'Tarif Harian',
    textTotal: 'TOTAL:',
    textPaymentMethod: 'METODE PEMBAYARAN:',
    textAccount: 'Akun',
    textPaymentPage: 'Halaman pembayaran yang aman',
    textQuestions: 'Untuk pertanyaan',
    textDisclaimer: "Faktur ini diterbitkan oleh pemilik alat. OxSteed adalah platform teknologi yang memfasilitasi penyewaan tetapi tidak menangani sengketa. Hubungi pemilik secara langsung atau selesaikan melalui proses chargeback bank Anda.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Transfer Bank' },
  },
  ur: {
    subject: (n) => `انوائس #${n} - OxSteed ٹول رینٹل`,
    preheader: (n) => `OxSteed کی طرف سے انوائس #${n}`,
    eyebrow: 'OXSTEED انوائس',
    title: (n) => `انوائس #${n}`,
    intro: (n, date) => `انوائس #${n} ${date} کو جاری کیا گیا۔`,
    sectionBilling: 'بلنگ کی معلومات',
    sectionRental: 'کرائے کی تفصیلات',
    sectionPayment: 'ادائیگی کی ہدایات',
    labelTool: 'آلہ',
    labelRentalPeriod: 'کرائے کی مدت',
    labelDailyRate: 'روزانہ کی شرح',
    labelTotal: 'کل رقم',
    perDay: '/یوم',
    labelPaymentMethod: 'ادائیگی کا طریقہ',
    labelAccount: 'اکاؤنٹ',
    labelAmountDue: 'واجب الادا رقم',
    scanQr: 'ادائیگی کے لیے QR کوڈ اسکین کریں:',
    qrAlt: 'ادائیگی کا QR کوڈ',
    noticeTitle: 'اہم',
    noticeBody: 'یہ انوائس ٹول کے مالک کی طرف سے جاری کیا جاتا ہے۔ OxSteed رابطہ فراہم کرتا ہے لیکن کرائے کے تنازعات کو کنٹرول نہیں کرتا۔',
    ctaLabel: 'محفوظ ادائیگی کا صفحہ کھولیں',
    footer: 'یہ ایک خودکار پیغام ہے۔ سوالات کے لیے support@oxsteed.com سے رابطہ کریں۔',
    textHeader: 'انوائس',
    textInvoiceNumber: 'انوائس نمبر:',
    textDate: 'تاریخ',
    textBillTo: 'بل وصول کنندہ:',
    textFrom: 'از طرف:',
    textRentalDetails: 'کرائے کی تفصیلات:',
    textTool: 'آلہ',
    textRentalPeriod: 'کرائے کی مدت',
    textDailyRate: 'روزانہ کی شرح',
    textTotal: 'کل:',
    textPaymentMethod: 'ادائیگی کا طریقہ:',
    textAccount: 'اکاؤنٹ',
    textPaymentPage: 'محفوظ ادائیگی کا صفحہ',
    textQuestions: 'سوالات کے لیے',
    textDisclaimer: "یہ انوائس ٹول کے مالک کی طرف سے جاری کیا جاتا ہے۔ OxSteed ایک تکنیکی پلیٹ فارم ہے جو کرائے کو سہولت دیتا ہے لیکن تنازعات کو کنٹرول نہیں کرتا۔ براہ راست مالک سے رابطہ کریں یا اپنے بینک کے چارج بیک عمل کے ذریعے حل کریں۔",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'بینک ٹرانسفر' },
  },
  bn: {
    subject: (n) => `চালান #${n} - OxSteed টুল ভাড়া`,
    preheader: (n) => `OxSteed থেকে চালান #${n}`,
    eyebrow: 'OXSTEED চালান',
    title: (n) => `চালান #${n}`,
    intro: (n, date) => `চালান #${n} ${date} তারিখে জারি করা হয়েছে।`,
    sectionBilling: 'বিলিং তথ্য',
    sectionRental: 'ভাড়ার বিবরণ',
    sectionPayment: 'পেমেন্ট নির্দেশনা',
    labelTool: 'টুল',
    labelRentalPeriod: 'ভাড়ার মেয়াদ',
    labelDailyRate: 'দৈনিক হার',
    labelTotal: 'মোট পরিমাণ',
    perDay: '/দিন',
    labelPaymentMethod: 'পেমেন্ট পদ্ধতি',
    labelAccount: 'অ্যাকাউন্ট',
    labelAmountDue: 'প্রদেয় পরিমাণ',
    scanQr: 'পেমেন্ট করতে QR কোড স্ক্যান করুন:',
    qrAlt: 'পেমেন্ট QR কোড',
    noticeTitle: 'গুরুত্বপূর্ণ',
    noticeBody: 'এই চালানটি টুলের মালিক জারি করেন। OxSteed সংযোগ সহজ করে তবে ভাড়া সংক্রান্ত বিরোধ নিয়ন্ত্রণ করে না।',
    ctaLabel: 'নিরাপদ পেমেন্ট পৃষ্ঠা খুলুন',
    footer: 'এটি একটি স্বয়ংক্রিয় বার্তা। প্রশ্ন থাকলে support@oxsteed.com-এ যোগাযোগ করুন।',
    textHeader: 'চালান',
    textInvoiceNumber: 'চালান #:',
    textDate: 'তারিখ',
    textBillTo: 'বিল প্রাপক:',
    textFrom: 'প্রেরক:',
    textRentalDetails: 'ভাড়ার বিবরণ:',
    textTool: 'টুল',
    textRentalPeriod: 'ভাড়ার মেয়াদ',
    textDailyRate: 'দৈনিক হার',
    textTotal: 'মোট:',
    textPaymentMethod: 'পেমেন্ট পদ্ধতি:',
    textAccount: 'অ্যাকাউন্ট',
    textPaymentPage: 'নিরাপদ পেমেন্ট পৃষ্ঠা',
    textQuestions: 'প্রশ্নের জন্য',
    textDisclaimer: "এই চালানটি টুলের মালিক জারি করেন। OxSteed একটি প্রযুক্তি প্ল্যাটফর্ম যা ভাড়া সহজ করে তবে বিরোধ নিয়ন্ত্রণ করে না। সরাসরি মালিকের সাথে যোগাযোগ করুন বা আপনার ব্যাংকের চার্জব্যাক প্রক্রিয়ার মাধ্যমে সমাধান করুন।",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'ব্যাংক ট্রান্সফার' },
  },
  it: {
    subject: (n) => `Fattura n. ${n} - Noleggio attrezzi OxSteed`,
    preheader: (n) => `Fattura n. ${n} da OxSteed`,
    eyebrow: 'FATTURA OXSTEED',
    title: (n) => `Fattura n. ${n}`,
    intro: (n, date) => `La fattura n. ${n} è stata emessa il ${date}.`,
    sectionBilling: 'Informazioni di fatturazione',
    sectionRental: 'Dettagli del noleggio',
    sectionPayment: 'Istruzioni di pagamento',
    labelTool: 'Attrezzo',
    labelRentalPeriod: 'Periodo di noleggio',
    labelDailyRate: 'Tariffa giornaliera',
    labelTotal: 'Importo totale',
    perDay: '/giorno',
    labelPaymentMethod: 'Metodo di pagamento',
    labelAccount: 'Conto',
    labelAmountDue: 'Importo dovuto',
    scanQr: 'Scansiona il codice QR per pagare:',
    qrAlt: 'Codice QR di pagamento',
    noticeTitle: 'Importante',
    noticeBody: 'Questa fattura è emessa dal proprietario dell\'attrezzo. OxSteed facilita il contatto ma non gestisce le controversie di noleggio.',
    ctaLabel: 'Apri la pagina di pagamento sicura',
    footer: 'Questo è un messaggio automatico. Per domande, contatta support@oxsteed.com.',
    textHeader: 'FATTURA',
    textInvoiceNumber: 'Fattura n.:',
    textDate: 'Data',
    textBillTo: 'FATTURARE A:',
    textFrom: 'DA:',
    textRentalDetails: 'DETTAGLI DEL NOLEGGIO:',
    textTool: 'Attrezzo',
    textRentalPeriod: 'Periodo di Noleggio',
    textDailyRate: 'Tariffa Giornaliera',
    textTotal: 'TOTALE:',
    textPaymentMethod: 'METODO DI PAGAMENTO:',
    textAccount: 'Conto',
    textPaymentPage: 'Pagina di pagamento sicura',
    textQuestions: 'Per domande',
    textDisclaimer: "Questa fattura è emessa dal proprietario dell'attrezzo. OxSteed è una piattaforma tecnologica che facilita i noleggi ma non gestisce le controversie. Contatta direttamente il proprietario o risolvi tramite la procedura di chargeback della tua banca.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Bonifico Bancario' },
  },
  tr: {
    subject: (n) => `Fatura #${n} - OxSteed Alet Kiralama`,
    preheader: (n) => `OxSteed'den #${n} numaralı fatura`,
    eyebrow: 'OXSTEED FATURASI',
    title: (n) => `Fatura #${n}`,
    intro: (n, date) => `#${n} numaralı fatura ${date} tarihinde düzenlendi.`,
    sectionBilling: 'Fatura bilgileri',
    sectionRental: 'Kiralama detayları',
    sectionPayment: 'Ödeme talimatları',
    labelTool: 'Alet',
    labelRentalPeriod: 'Kiralama süresi',
    labelDailyRate: 'Günlük ücret',
    labelTotal: 'Toplam tutar',
    perDay: '/gün',
    labelPaymentMethod: 'Ödeme yöntemi',
    labelAccount: 'Hesap',
    labelAmountDue: 'Ödenecek tutar',
    scanQr: 'Ödemek için QR kodunu tarayın:',
    qrAlt: 'Ödeme QR kodu',
    noticeTitle: 'Önemli',
    noticeBody: 'Bu fatura alet sahibi tarafından düzenlenir. OxSteed bağlantıyı kolaylaştırır ancak kiralama anlaşmazlıklarını yönetmez.',
    ctaLabel: 'Güvenli ödeme sayfasını aç',
    footer: 'Bu otomatik bir mesajdır. Sorularınız için support@oxsteed.com ile iletişime geçin.',
    textHeader: 'FATURA',
    textInvoiceNumber: 'Fatura #:',
    textDate: 'Tarih',
    textBillTo: 'FATURA EDİLECEK KİŞİ:',
    textFrom: 'GÖNDEREN:',
    textRentalDetails: 'KİRALAMA DETAYLARI:',
    textTool: 'Alet',
    textRentalPeriod: 'Kiralama Süresi',
    textDailyRate: 'Günlük Ücret',
    textTotal: 'TOPLAM:',
    textPaymentMethod: 'ÖDEME YÖNTEMİ:',
    textAccount: 'Hesap',
    textPaymentPage: 'Güvenli ödeme sayfası',
    textQuestions: 'Sorular için',
    textDisclaimer: "Bu fatura alet sahibi tarafından düzenlenir. OxSteed, kiralamaları kolaylaştıran bir teknoloji platformudur ancak anlaşmazlıkları yönetmez. Doğrudan sahibiyle iletişime geçin veya bankanızın ters ibraz süreciyle çözün.",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'Banka Havalesi' },
  },
  th: {
    subject: (n) => `ใบแจ้งหนี้ #${n} - เช่าเครื่องมือ OxSteed`,
    preheader: (n) => `ใบแจ้งหนี้ #${n} จาก OxSteed`,
    eyebrow: 'ใบแจ้งหนี้ OXSTEED',
    title: (n) => `ใบแจ้งหนี้ #${n}`,
    intro: (n, date) => `ใบแจ้งหนี้ #${n} ออกเมื่อวันที่ ${date}`,
    sectionBilling: 'ข้อมูลการเรียกเก็บเงิน',
    sectionRental: 'รายละเอียดการเช่า',
    sectionPayment: 'คำแนะนำการชำระเงิน',
    labelTool: 'เครื่องมือ',
    labelRentalPeriod: 'ระยะเวลาการเช่า',
    labelDailyRate: 'อัตรารายวัน',
    labelTotal: 'ยอดรวม',
    perDay: '/วัน',
    labelPaymentMethod: 'วิธีการชำระเงิน',
    labelAccount: 'บัญชี',
    labelAmountDue: 'ยอดที่ต้องชำระ',
    scanQr: 'สแกน QR Code เพื่อชำระเงิน:',
    qrAlt: 'QR Code ชำระเงิน',
    noticeTitle: 'สำคัญ',
    noticeBody: 'ใบแจ้งหนี้นี้ออกโดยเจ้าของเครื่องมือ OxSteed เป็นตัวกลางในการเชื่อมต่อเท่านั้น ไม่ได้จัดการข้อพิพาทการเช่า',
    ctaLabel: 'เปิดหน้าชำระเงินที่ปลอดภัย',
    footer: 'นี่คือข้อความอัตโนมัติ หากมีคำถาม โปรดติดต่อ support@oxsteed.com',
    textHeader: 'ใบแจ้งหนี้',
    textInvoiceNumber: 'เลขที่ใบแจ้งหนี้:',
    textDate: 'วันที่',
    textBillTo: 'เรียกเก็บเงินจาก:',
    textFrom: 'จาก:',
    textRentalDetails: 'รายละเอียดการเช่า:',
    textTool: 'เครื่องมือ',
    textRentalPeriod: 'ระยะเวลาการเช่า',
    textDailyRate: 'อัตรารายวัน',
    textTotal: 'รวม:',
    textPaymentMethod: 'วิธีการชำระเงิน:',
    textAccount: 'บัญชี',
    textPaymentPage: 'หน้าชำระเงินที่ปลอดภัย',
    textQuestions: 'หากมีคำถาม',
    textDisclaimer: "ใบแจ้งหนี้นี้ออกโดยเจ้าของเครื่องมือ OxSteed เป็นแพลตฟอร์มเทคโนโลยีที่อำนวยความสะดวกในการเช่า แต่ไม่ได้จัดการข้อพิพาท โปรดติดต่อเจ้าของโดยตรงหรือแก้ไขผ่านกระบวนการ chargeback ของธนาคาร",
    paymentMethodNames: { cash_app: 'Cash App', venmo: 'Venmo', bank_transfer: 'โอนเงินผ่านธนาคาร' },
  },
};

function getInvoiceCopy(language) {
  const lang = normalizeEmailLanguage(language);
  return { lang, copy: INVOICE_COPY[lang] || INVOICE_COPY.en };
}

/**
 * Locale-aware date formatting for the invoice email.
 * Date-only strings (YYYY-MM-DD) are parsed as local calendar dates, not UTC
 * midnight, so the rendered day never shifts with the server timezone.
 */
function formatInvoiceDate(value, lang) {
  let date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (m) {
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(EMAIL_LOCALE_TAGS[lang] || EMAIL_LOCALE_TAGS.en);
}

/**
 * Resolve the ISO 4217 currency code for an invoice row.
 * tool_rental_invoices has no currency column, so we use the recipient's
 * preferred_currency (users.preferred_currency, defaults to USD) when the
 * invoice row itself carries no currency_code.
 */
function resolveInvoiceCurrency(invoice) {
  const raw = String(invoice.currency_code || invoice.customer_currency || FALLBACK_CURRENCY).toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : FALLBACK_CURRENCY;
}

/**
 * Format a money amount with the right locale and currency.
 * Falls back to the legacy "$X.XX" formatting if Intl cannot handle the code.
 */
function formatInvoiceMoney(amount, lang, currency) {
  const value = Number.parseFloat(amount || 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const tag = EMAIL_LOCALE_TAGS[lang] || EMAIL_LOCALE_TAGS.en;
  try {
    return new Intl.NumberFormat(tag, { style: 'currency', currency }).format(safeValue);
  } catch (err) {
    return `$${safeValue.toFixed(2)}`;
  }
}

/**
 * Generate HTML email template for invoice
 * @param {Object} invoice - Invoice record with details
 * @param {string} qrCodeDataUrl - Base64 encoded QR code image
 * @param {string} paymentLink - Secure payment page URL
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 * @returns {string} HTML email content
 */
function renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink = '', language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const currency = resolveInvoiceCurrency(invoice);
  const ownerName = `${invoice.owner_first || ''} ${invoice.owner_last || ''}`.trim();
  const customerName = `${invoice.customer_first || ''} ${invoice.customer_last || ''}`.trim();
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier, lang);
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const createdDate = formatInvoiceDate(invoice.created_at, lang);
  const startDate = formatInvoiceDate(invoice.start_date, lang);
  const endDate = formatInvoiceDate(invoice.end_date, lang);
  const dailyRate = formatInvoiceMoney(invoice.daily_rate, lang, currency);
  const totalAmount = formatInvoiceMoney(invoice.total_amount, lang, currency);
  const safeQrCode = escapeHtml(qrCodeDataUrl || '');
  const bodyHtml = `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${escapeHtml(copy.intro(invoiceNumber, createdDate))}</p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionBilling)}</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${escapeHtml(customerName)}</strong><br><a href="mailto:${escapeHtml(invoice.customer_email || '')}" style="color:#c2410c;">${escapeHtml(invoice.customer_email || '')}</a></p><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionRental)}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;"><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelTool)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;font-weight:700;">${escapeHtml(invoice.tool_name || '')}</td></tr><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelRentalPeriod)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;">${escapeHtml(startDate)} – ${escapeHtml(endDate)}</td></tr><tr><td style="padding:9px 0;color:#64748b;">${escapeHtml(copy.labelDailyRate)}</td><td style="padding:9px 0;text-align:right;color:#0f172a;">${escapeHtml(dailyRate)}${escapeHtml(copy.perDay)}</td></tr><tr><td style="padding:12px 0;color:#0f172a;font-weight:700;">${escapeHtml(copy.labelTotal)}</td><td style="padding:12px 0;text-align:right;color:#c2410c;font-size:18px;font-weight:800;">${escapeHtml(totalAmount)}</td></tr></table><h2 style="margin:24px 0 10px;color:#0f172a;font-size:17px;">${escapeHtml(copy.sectionPayment)}</h2><p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;"><strong>${escapeHtml(copy.labelPaymentMethod)}:</strong> ${escapeHtml(paymentMethodDisplay.display)}<br><strong>${escapeHtml(copy.labelAccount)}:</strong> ${escapeHtml(paymentMethodDisplay.masked)}<br><strong>${escapeHtml(copy.labelAmountDue)}:</strong> ${escapeHtml(totalAmount)}</p><p style="margin:20px 0 8px;text-align:center;color:#64748b;font-size:14px;">${escapeHtml(copy.scanQr)}</p><p style="margin:0;text-align:center;"><img src="${safeQrCode}" alt="${escapeHtml(copy.qrAlt)}" width="200" style="display:inline-block;max-width:200px;height:auto;border:1px solid #e2e8f0;border-radius:8px;"></p>`;
  return renderOxSteedEmail({
    language: lang,
    preheader: copy.preheader(invoiceNumber),
    eyebrow: copy.eyebrow,
    title: copy.title(invoiceNumber),
    bodyHtml,
    bodyText: renderInvoiceText(invoice, paymentLink, lang),
    notice: { title: copy.noticeTitle, body: copy.noticeBody, tone: 'warning' },
    cta: paymentLink ? { label: copy.ctaLabel, url: paymentLink } : null,
    footerText: copy.footer,
  }).html;
}

/**
 * Generate plain text version of invoice email
 * @param {Object} invoice - Invoice record with details
 * @param {string} paymentLink - Secure payment page URL
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 */
function renderInvoiceText(invoice, paymentLink = '', language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const currency = resolveInvoiceCurrency(invoice);
  const ownerName = `${invoice.owner_first || ''} ${invoice.owner_last || ''}`.trim();
  const customerName = `${invoice.customer_first || ''} ${invoice.customer_last || ''}`.trim();
  const invoiceNumber = invoice.invoice_number || invoice.id || '';
  const paymentMethodDisplay = formatPaymentMethod(invoice.payment_type, invoice.payment_identifier, lang);
  const dailyRate = formatInvoiceMoney(invoice.daily_rate, lang, currency);
  const totalAmount = formatInvoiceMoney(invoice.total_amount, lang, currency);

  return `${copy.textHeader}
${copy.textInvoiceNumber} ${invoiceNumber}
${copy.textDate}: ${formatInvoiceDate(invoice.created_at, lang)}

${copy.textBillTo}
${customerName}
${invoice.customer_email || ''}

${copy.textFrom}
${ownerName}
${invoice.owner_email || ''}

${copy.textRentalDetails}
${copy.textTool}: ${invoice.tool_name || ''}
${copy.textRentalPeriod}: ${formatInvoiceDate(invoice.start_date, lang)} - ${formatInvoiceDate(invoice.end_date, lang)}
${copy.textDailyRate}: ${dailyRate}${copy.perDay}

${copy.textTotal} ${totalAmount}

${copy.textPaymentMethod}
${copy.labelPaymentMethod}: ${paymentMethodDisplay.display}
${copy.textAccount}: ${paymentMethodDisplay.masked || ''}

${copy.textDisclaimer}

${paymentLink ? `\n${copy.textPaymentPage}: ${paymentLink}\n` : ''}
${copy.textQuestions}: support@oxsteed.com`;
}

/**
 * Format payment method for display (with masking)
 */
function formatPaymentMethod(type, identifier, language = 'en') {
  const { copy } = getInvoiceCopy(language);
  const safeType = String(type || '');
  const safeIdentifier = String(identifier || '');
  const names = copy.paymentMethodNames;
  let display = '';
  let masked = '';

  switch (safeType.toLowerCase()) {
    case 'cash_app':
      display = names.cash_app;
      masked = safeIdentifier.length > 4 ? '*'.repeat(safeIdentifier.length - 4) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    case 'venmo':
      display = names.venmo;
      masked = safeIdentifier.length > 4 ? '*'.repeat(safeIdentifier.length - 4) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    case 'bank_transfer':
      display = names.bank_transfer;
      masked = safeIdentifier.length > 4 ? safeIdentifier.slice(0, 4) + '*'.repeat(safeIdentifier.length - 8) + safeIdentifier.slice(-4) : safeIdentifier;
      break;
    default:
      display = safeType;
      masked = safeIdentifier;
  }

  return { display, masked };
}

/**
 * Send invoice email with retry logic
 * @param {Object} invoice - Invoice record
 * @param {string} recipientEmail - Recipient email address
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @param {string} language - Recipient language code (en/es/fr/ht/ar), defaults to 'en'
 * @returns {Promise<{success: boolean, error?: string, attempt: number}>}
 */
async function sendInvoiceEmail(invoice, recipientEmail, maxRetries = 3, language = 'en') {
  const { lang, copy } = getInvoiceCopy(language);
  const CLIENT_URL = process.env.CLIENT_URL || 'https://oxsteed.com';
  const paymentLink = invoice.id
    ? `${CLIENT_URL}/tool-rentals?rentalInvoiceId=${encodeURIComponent(invoice.id)}`
    : `${CLIENT_URL}/invoices`;

  let lastError = null;
  let attempt = 0;

  for (attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Generate QR code (synchronously for simple retries)
      const qrCodeDataUrl = await QRCode.toDataURL(paymentLink);

      // Render email
      const html = renderInvoiceHTML(invoice, qrCodeDataUrl, paymentLink, lang);
      const text = renderInvoiceText(invoice, paymentLink, lang);

      // Send email
      const result = await sendEmail({
        to: recipientEmail,
        subject: copy.subject(invoice.invoice_number || invoice.id || ''),
        text,
        html,
        idempotencyKey: `invoice:${invoice.id || invoice.invoice_number}:${recipientEmail}`,
      });

      if (result.success) {
        // Review P3-852: mask the recipient address in logs (PII).
        logger.info('Invoice email sent successfully', {
          invoiceId: invoice.id,
          recipientEmail: maskEmail(recipientEmail),
          attempt,
          language: lang,
        });
        return { success: true, attempt };
      } else {
        lastError = result.error;
        logger.warn('Invoice email send failed, will retry', {
          invoiceId: invoice.id,
          recipientEmail: maskEmail(recipientEmail),
          attempt,
          error: lastError,
        });

        // Exponential backoff: 1s, 2s, 4s
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (err) {
      lastError = err.message;
      logger.error('Invoice email send exception', {
        invoiceId: invoice.id,
        recipientEmail: maskEmail(recipientEmail),
        attempt,
        error: err.message,
      });

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logger.error('Invoice email send failed after retries', {
    invoiceId: invoice.id,
    recipientEmail: maskEmail(recipientEmail),
    maxRetries,
    lastError,
  });

  return { success: false, error: lastError || 'Email send failed', attempt: maxRetries };
}

module.exports = {
  sendInvoiceEmail,
  renderInvoiceHTML,
  renderInvoiceText,
  formatPaymentMethod,
  getInvoiceCopy,
  formatInvoiceMoney,
  resolveInvoiceCurrency,
  INVOICE_COPY,
  EMAIL_LOCALE_TAGS,
};
