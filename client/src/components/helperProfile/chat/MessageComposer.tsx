import React, { useRef, useState } from 'react';
import { Send, Paperclip, Image, Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatStatus } from '../../../types/helperProfile';

interface MessageComposerProps {
  status: ChatStatus;
  onSend: (text: string) => void;
  placeholder?: string;
  /** Hide attachment/emoji row for a lighter composer (e.g. guest profile chat) */
  compact?: boolean;
  /** Extra hint above the textarea (e.g. guest flow: contact saved) */
  hint?: React.ReactNode;
  disabled?: boolean;
}

const DISABLED_STATUSES: ChatStatus[] = ['offline'];

const EMOJI_GRID = ['😀', '😂', '😍', '😮', '😢', '😡', '👍', '👎', '❤️', '🎉', '🔥', '💯', '😎', '🤔', '👏', '🙏', '💪', '🎯', '📱', '⭐', '🚀', '✅', '❌', '⚡'];

const MessageComposer: React.FC<MessageComposerProps> = ({
  status,
  onSend,
  placeholder,
  compact = false,
  hint,
  disabled: disabledProp = false,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const isDisabled = disabledProp || DISABLED_STATUSES.includes(status);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
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

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    setText('');
    setShowEmojiPicker(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const addEmoji = (emoji: string) => {
    setText(prev => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker]);

  const defaultPlaceholder =
    status === 'offline'
      ? t('messages.offlinePlaceholder')
      : status === 'message_mode'
      ? t('messages.leaveMessagePlaceholder')
      : t('messages.typeMessage');

  return (
    <div
      className={`px-3 py-3 bg-gray-900 border-t border-gray-800 ${
        isDisabled ? 'opacity-60' : ''
      }`}
      aria-label="Message composer"
    >
      {hint && (
        <div className="mb-2 text-xs text-gray-400 px-0.5" role="status">
          {hint}
        </div>
      )}
      {/* Attachment row */}
      {!compact && (
      <div className="flex items-center gap-1 mb-2 relative">
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label={t('messages.attachFile')}
          disabled
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label={t('messages.attachImage')}
          disabled
          title="Attach image"
        >
          <Image className="w-4 h-4" aria-hidden="true" />
        </button>
        <div className="relative" ref={emojiPickerRef}>
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
            aria-label={t('messages.addEmoji')}
            title="Emoji"
          >
            <Smile className="w-4 h-4" aria-hidden="true" />
          </button>
          {showEmojiPicker && (
            <div className="absolute bottom-full left-0 mb-2 bg-gray-800 border border-gray-700 rounded-lg p-2 z-50 grid grid-cols-6 gap-1">
              {EMOJI_GRID.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => addEmoji(emoji)}
                  className="text-lg hover:bg-gray-700 p-1.5 rounded hover:scale-110 transition-transform"
                  aria-label={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
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
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-colors disabled:cursor-not-allowed leading-relaxed"
          aria-label={t('messages.messageInput')}
          aria-multiline="true"
          style={{ minHeight: '40px', maxHeight: '120px', fontSize: '16px' }}
        />
        <button
          onClick={submit}
          disabled={!text.trim() || isDisabled}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:text-gray-500 text-white flex items-center justify-center transition-colors"
          aria-label={t('messages.sendMessage')}
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default MessageComposer;
