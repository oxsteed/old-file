import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  FileText,
  Receipt,
  ScrollText,
  ShoppingCart,
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
  onPartsList = null,
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
      <button type="button" className="messages-quote-share-btn" onClick={onQuote} title={t('messages.quoteShare.title')} data-track="ui.8e7101cbfa.1">
        <FileText size={14} aria-hidden />
        <span className="hide-sm">{t('messages.quoteShare.button')}</span>
      </button>
      {onPartsList ? (
        <button type="button" className="messages-quote-share-btn" onClick={onPartsList} title={t('partsList.toolbarLabel')} aria-label={t('partsList.toolbarLabel')} data-track="ui.8e7101cbfa.2">
          <ShoppingCart size={14} aria-hidden />
          <span className="hide-sm">{t('partsList.toolbarLabel')}</span>
        </button>
      ) : null}
      <button type="button" className="messages-quote-share-btn" onClick={onPaymentRequest} title={t('messages.paymentRequestShare.title')} data-track="ui.8e7101cbfa.3" data-track-private>
        <Wallet size={14} aria-hidden />
        <span className="hide-sm">{t('messages.paymentRequestShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onAgreement} title={t('messages.agreementShare.title')} data-track="ui.8e7101cbfa.4">
        <ScrollText size={14} aria-hidden />
        <span className="hide-sm">{t('messages.agreementShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onPop} title={t('messages.popShare.title')} data-track="ui.8e7101cbfa.5">
        <Receipt size={14} aria-hidden />
        <span className="hide-sm">{t('messages.popShare.button')}</span>
      </button>
      <button type="button" className="messages-quote-share-btn" onClick={onSchedule} title={t('messages.providerToolbar.schedule')} data-track="ui.8e7101cbfa.6">
        <CalendarDays size={14} aria-hidden />
        <span className="hide-sm">{t('messages.providerToolbar.schedule')}</span>
      </button>
      {showRefund ? (
        <button type="button" className="messages-quote-share-btn" onClick={onRefund} title={t('messages.creditRefund.title')} data-track="ui.8e7101cbfa.7">
          <Undo2 size={14} aria-hidden />
          <span className="hide-sm">{t('messages.creditRefund.button')}</span>
        </button>
      ) : null}
      <button type="button" className="messages-quote-share-btn" onClick={onContact} title={t('messages.contactDrawer.title')} data-track="ui.8e7101cbfa.8">
        <UserRound size={14} aria-hidden />
        <span className="hide-sm">{t('messages.contactDrawer.button')}</span>
      </button>
    </div>
  );
}
