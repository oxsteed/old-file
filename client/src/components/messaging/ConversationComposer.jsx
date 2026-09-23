import { useRef, useState } from 'react';
import { Image, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { uploadMessageAttachment } from '../../api/chat';
import { toStoredAttachment, attachmentLabel, isImageAttachment } from '../../utils/messageAttachments';

const MAX_CHARS = 4000;

export default function ConversationComposer({
  conversationId,
  value,
  onChange,
  onBlur,
  onSend,
  sending,
  inputRef,
  starters = [],
  showStarters = false,
  placeholder,
  uploadAttachment = uploadMessageAttachment,
}) {
  const { t } = useTranslation();
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const textareaRef = inputRef;

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const handleChange = (event) => {
    onChange(event);
    autoResize(event.target);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleFocus = () => {
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!conversationId) {
      toast.error(t('messages.attachNeedsConversation'));
      return;
    }
    setUploading(true);
    try {
      const meta = await uploadAttachment(conversationId, file);
      setPendingAttachment(toStoredAttachment(meta) || meta);
    } catch {
      toast.error(t('messages.attachUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const trimmed = (value || '').trim();
    if ((!trimmed && !pendingAttachment) || sending || uploading) return;
    onSend({
      content: trimmed,
      attachments: pendingAttachment ? [pendingAttachment] : [],
    });
    setPendingAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const remaining = MAX_CHARS - (value || '').length;
  const canSend = Boolean((value || '').trim() || pendingAttachment) && !sending && !uploading;

  return (
    <div className="messages-composer">
      {showStarters && starters.length > 0 && (
        <div className="messages-starters" aria-label={t('messages.starters.title')}>
          <p>{t('messages.starters.title')}</p>
          <div>
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onSend({ content: starter, attachments: [] })}
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingAttachment && (
        <div className="messages-pending-attachment">
          {isImageAttachment(pendingAttachment) ? (
            <img src={pendingAttachment.url} alt={attachmentLabel(pendingAttachment)} />
          ) : (
            <Paperclip size={16} aria-hidden />
          )}
          <span>{attachmentLabel(pendingAttachment)}</span>
          <button
            type="button"
            onClick={() => setPendingAttachment(null)}
            aria-label={t('common.remove')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
      />

      <div className="messages-composer-tools">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={uploading || !conversationId}
          aria-label={t('messages.attachImage')}
          title={t('messages.attachImage')}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Image size={16} />}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !conversationId}
          aria-label={t('messages.attachFile')}
          title={t('messages.attachFile')}
        >
          <Paperclip size={16} />
        </button>
        <span>{t('messages.shiftEnter')}</span>
        {remaining < 500 && (
          <span className={remaining < 0 ? 'over' : ''}>
            {t('messages.characterCount', { count: remaining })}
          </span>
        )}
      </div>

      <form
        className="messages-composer-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          maxLength={MAX_CHARS}
          rows={1}
          aria-label={t('messages.messageInput')}
          aria-multiline="true"
        />
        <button type="submit" disabled={!canSend} aria-label={t('messages.sendMessage')}>
          {sending || uploading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}
