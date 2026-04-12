import React, { useRef, useState } from 'react';
import { Send, Paperclip, Image, Smile } from 'lucide-react';
import type { ChatStatus } from '../../../types/helperProfile';

interface MessageComposerProps {
  status: ChatStatus;
  onSend: (text: string) => void;
  placeholder?: string;
}

const DISABLED_STATUSES: ChatStatus[] = ['offline'];

const MessageComposer: React.FC<MessageComposerProps> = ({
  status,
  onSend,
  placeholder,
}) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDisabled = DISABLED_STATUSES.includes(status);

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
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const defaultPlaceholder =
    status === 'offline'
      ? 'This helper is currently offline.'
      : status === 'message_mode'
      ? "Leave a message — they'll reply soon..."
      : 'Type a message…';

  return (
    <div
      className={`px-3 py-3 bg-gray-900 border-t border-gray-800 ${
        isDisabled ? 'opacity-60' : ''
      }`}
      aria-label="Message composer"
    >
      {/* Attachment row */}
      <div className="flex items-center gap-1 mb-2">
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label="Attach file (coming soon)"
          disabled
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label="Attach image (coming soon)"
          disabled
          title="Attach image"
        >
          <Image className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          aria-label="Add emoji (coming soon)"
          disabled
          title="Emoji"
        >
          <Smile className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="text-xs text-gray-600 ml-auto hidden sm:block">Shift+Enter for new line</span>
      </div>

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
          aria-label="Message input"
          aria-multiline="true"
          style={{ minHeight: '40px', maxHeight: '120px', fontSize: '16px' }}
        />
        <button
          onClick={submit}
          disabled={!text.trim() || isDisabled}
          className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:text-gray-500 text-white flex items-center justify-center transition-colors"
          aria-label="Send message"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default MessageComposer;
