import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  FileText,
  Receipt,
  ScrollText,
  Undo2,
  UserRound,
  Wallet,
} from 'lucide-react';

/**
 * Shared provider action bar. Parent owns panels; this only emits intents.
 */
export default function ProviderMessengerToolbar({
  onQuote,
  onPaymentRequest,
  onAgreement,
  onPop,
  onSchedule,
  onRefund,
  onContact,
  showRefund = false,
  className = '',
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`provider-messenger-toolbar ${className}`.trim()}
      role="toolbar"
      aria-label={t('messages.providerToolbar.aria')}
    >
      <button type="button" className="messages-quote-share-btn" onClick={onQuote} title={t('messages.quoteShare.title')}>
        <FileText size={14} aria-hidden />
        <span className="hide-sm">{t('messages.quoteShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onPaymentRequest} title={t('messages.paymentRequestShare.title')}>
        <Wallet size={14} aria-hidden />
        <span className="hide-sm">{t('messages.paymentRequestShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onAgreement} title={t('messages.agreementShare.title')}>
        <ScrollText size={14} aria-hidden />
        <span className="hide-sm">{t('messages.agreementShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onPop} title={t('messages.popShare.title')}>
        <Receipt size={14} aria-hidden />
        <span className="hide-sm">{t('messages.popShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onSchedule} title={t('messages.providerToolbar.schedule')}>
        <CalendarDays size={14} aria-hidden />
        <span className="hide-sm">{t('messages.providerToolbar.schedule')}</span>
      </button>
      {showRefund ? (
        <button type="button" className="messages-quote-share-btn" onClick={onRefund} title={t('messages.creditRefund.title')}>
          <Undo2 size={14} aria-hidden />
          <span className="hide-sm">{t('messages.creditRefund.button')}</span>
        </button>
      ) : null}
      <button type="button" className="messages-quote-share-btn" onClick={onContact} title={t('messages.contactDrawer.title')}>
        <UserRound size={14} aria-hidden />
        <span className="hide-sm">{t('messages.contactDrawer.button')}</span>
      </button>
    </div>
  );
}
