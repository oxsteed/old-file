import React, { useRef, useState } from 'react';
import { Send, Paperclip, Image, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import type { ChatStatus } from '../../../types/helperProfile';

export interface AttachmentMeta {
  url: string;
  key: string | null;
  name: string;
  size: number;
  mimeType: string;
}

interface MessageComposerProps {
  status: ChatStatus;
  onSend: (text: string, attachment?: AttachmentMeta) => void;
  placeholder?: string;
  /** Hide attachment/emoji row for a lighter composer (e.g. guest profile chat) */
  compact?: boolean;
  roomy?: boolean;
  /** Extra hint above the textarea (e.g. guest flow: contact saved) */
  hint?: React.ReactNode;
  disabled?: boolean;
  /** conversationId needed for server-side upload; omit to disable upload */
  conversationId?: string | null;
  /** External ref to control textarea focus/scroll */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

const DISABLED_STATUSES: ChatStatus[] = ['offline'];

const MessageComposer: React.FC<MessageComposerProps> = ({
  status,
  onSend,
  placeholder,
  compact = false,
  roomy = false,
  hint,
  disabled: disabledProp = false,
  conversationId,
  textareaRef: externalTextareaRef,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentMeta | null>(null);
  const [uploading, setUploading] = useState(false);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isDisabled = disabledProp || DISABLED_STATUSES.includes(status);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, roomy ? 220 : 120)}px`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    autoResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // On mobile, when the keyboard opens it can push content off-screen.
  // scrollIntoView ensures the textarea stays visible above the keyboard.
  const handleFocus = () => {
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!conversationId) {
      toast.error(t('messages.attachNeedsConversation') || 'Start a conversation first to send attachments');
      return;
    }

    setUploading(true);
    try {
      // Lazy-import to keep initial bundle small
      const { uploadMessageAttachment } = await import('../../../api/chat');
      const meta = await uploadMessageAttachment(conversationId, file);
      setPendingAttachment(meta);
    } catch {
      toast.error(t('messages.attachUploadFailed') || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const trimmed = text.trim();
    if ((!trimmed && !pendingAttachment) || isDisabled || uploading) return;
    onSend(trimmed, pendingAttachment ?? undefined);
    setText('');
    setPendingAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const defaultPlaceholder =
    status === 'offline'
      ? t('messages.offlinePlaceholder')
      : status === 'message_mode'
      ? t('messages.leaveMessagePlaceholder')
      : t('messages.typeMessage');

  return (
    <div
      className={`${roomy ? 'px-4 py-4' : 'px-3 py-3'} bg-gray-900 border-t border-gray-800 ${
        isDisabled ? 'opacity-60' : ''
      }`}
      aria-label={t('helperProfile.chat.messageComposer')}
    >
      {hint && (
        <div className="mb-2 text-xs text-gray-400 px-0.5" role="status">
          {hint}
        </div>
      )}

      {/* Pending attachment preview */}
      {pendingAttachment && (
        <div className="flex items-center gap-2 mb-2 px-1 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300">
          {pendingAttachment.mimeType.startsWith('image/') ? (
            <img
              src={pendingAttachment.url}
              alt={pendingAttachment.name}
              className="w-10 h-10 rounded object-cover flex-shrink-0"
            />
          ) : (
            <Paperclip className="w-4 h-4 flex-shrink-0 text-gray-400" />
          )}
          <span className="flex-1 truncate">{pendingAttachment.name}</span>
          <button
            onClick={() => setPendingAttachment(null)}
            className="p-0.5 rounded text-gray-500 hover:text-red-400 transition-colors"
            aria-label={t('common.remove') || 'Remove'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hidden file inputs */}
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

      {/* Attachment row */}
      {!compact && (
      <div className="flex items-center gap-1 mb-2">
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
          aria-label={t('messages.attachFile')}
          disabled={isDisabled || uploading || !conversationId}
          title={conversationId ? t('messages.attachFile') : (t('messages.attachNeedsConversation') || 'Send a message first')}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" aria-hidden="true" />}
        </button>
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-40"
          aria-label={t('messages.attachImage')}
          disabled={isDisabled || uploading || !conversationId}
          title={conversationId ? t('messages.attachImage') : (t('messages.attachNeedsConversation') || 'Send a message first')}
          onClick={() => imageInputRef.current?.click()}
          type="button"
        >
          <Image className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="text-xs text-gray-600 ml-auto hidden sm:block">{t('messages.shiftEnter')}</span>
      </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={placeholder ?? defaultPlaceholder}
          disabled={isDisabled}
          rows={roomy ? 3 : 1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:cursor-not-allowed leading-relaxed"
          aria-label={t('messages.messageInput')}
          aria-multiline="true"
          style={{ minHeight: roomy ? '86px' : '40px', maxHeight: roomy ? '220px' : '120px', fontSize: '16px' }}
        />
        <button
          onClick={submit}
          disabled={(!text.trim() && !pendingAttachment) || isDisabled || uploading}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:text-gray-500 text-white flex items-center justify-center transition-colors"
          aria-label={t('messages.sendMessage')}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};

export default MessageComposer;
