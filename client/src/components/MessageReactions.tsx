import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SmilePlus, X } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

interface Reaction {
  reaction: string;
  count: number;
  users?: { user_id: number; name: string }[];
  user_reacted?: boolean;
}

interface MessageReactionsProps {
  conversationId: string | number;
  messageId: string | number;
  reactions?: Reaction[];
  onReactionsUpdate?: (reactions: Reaction[]) => void;
}

const REACTION_EMOJI: Record<string, string> = {
  thumbs_up: '👍',
  heart: '❤️',
  laugh: '😂',
  sad: '😢',
  angry: '😠',
  wow: '😮',
};

const REACTION_KEYS = Object.keys(REACTION_EMOJI);

export default function MessageReactions({
  conversationId,
  messageId,
  reactions = [],
  onReactionsUpdate,
}: MessageReactionsProps) {
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPicker]);

  const handleAddReaction = async (reaction: string) => {
    setLoading(true);
    try {
      const response = await api.post(
        `/messages/conversations/${conversationId}/${messageId}/reactions`,
        { reaction }
      );
      onReactionsUpdate?.(response.data.allReactions);
      setShowPicker(false);
    } catch (error: any) {
      if (error.response?.status === 404) {
        toast.error(t('messages.messageNotFound'));
      } else {
        toast.error(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveReaction = async (reaction: string) => {
    setLoading(true);
    try {
      const response = await api.delete(
        `/messages/conversations/${conversationId}/${messageId}/reactions`,
        { data: { reaction } }
      );
      onReactionsUpdate?.(response.data.allReactions);
    } catch (error: any) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  if (reactions.length === 0 && !showPicker) {
    return (
      <button
        onClick={() => setShowPicker(true)}
        className="mt-2 p-1 text-gray-500 hover:text-orange-500 transition-colors"
        title={t('messages.addReaction')}
        disabled={loading}
      >
        <SmilePlus size={16} />
      </button>
    );
  }

  return (
    <div className="mt-2 relative flex flex-wrap gap-1 items-center">
      {/* Display existing reactions */}
      {reactions.map((r) => (
        <div
          key={r.reaction}
          className="inline-flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm cursor-pointer transition-colors group"
          onClick={() =>
            r.user_reacted
              ? handleRemoveReaction(r.reaction)
              : handleAddReaction(r.reaction)
          }
          title={r.users?.map((u) => u.name).join(', ')}
        >
          <span>{REACTION_EMOJI[r.reaction]}</span>
          <span className="text-gray-300">{r.count}</span>
          {r.user_reacted && (
            <X
              size={12}
              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </div>
      ))}

      {/* Add reaction button */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="p-1 text-gray-500 hover:text-orange-500 transition-colors"
          title={t('messages.addReaction')}
          disabled={loading}
        >
          <SmilePlus size={16} />
        </button>

        {/* Reaction picker */}
        {showPicker && (
          <div className="absolute bottom-full mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-2 flex gap-1 z-50">
            {REACTION_KEYS.map((reaction) => (
              <button
                key={reaction}
                onClick={() => handleAddReaction(reaction)}
                className="text-lg hover:scale-125 transition-transform p-1 rounded hover:bg-gray-700"
                title={t(`messages.reactions.${reaction}`)}
                disabled={loading}
              >
                {REACTION_EMOJI[reaction]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
