import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { toolRentalsApi } from '../api/toolRentals';
import toast from 'react-hot-toast';
import './ToolFavoriteButton.css';

interface ToolFavoriteButtonProps {
  toolId: number;
  onFavoriteChange?: (favorited: boolean) => void;
}

const ToolFavoriteButton: React.FC<ToolFavoriteButtonProps> = ({ toolId, onFavoriteChange }) => {
  const { t } = useTranslation();
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkFavorited();
  }, [toolId]);

  const checkFavorited = async () => {
    try {
      const favorited = await toolRentalsApi.isFavorited(toolId);
      setIsFavorited(favorited);
    } catch (err) {
      console.error('Failed to check favorite status:', err);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const result = await toolRentalsApi.toggleFavorite(toolId);
      setIsFavorited(result.favorited);
      toast.success(
        result.favorited
          ? t('toolRentals.addedToFavorites')
          : t('toolRentals.removedFromFavorites')
      );
      onFavoriteChange?.(result.favorited);
    } catch (err) {
      toast.error('Failed to update favorite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggleFavorite}
      disabled={loading}
      className={`tool-favorite-button ${isFavorited ? 'favorited' : ''}`}
      aria-label={isFavorited ? t('toolRentals.removedFromFavorites') : t('toolRentals.addedToFavorites')}
    >
      <Heart className={`w-5 h-5 ${isFavorited ? 'fill-red-500' : ''}`} />
    </button>
  );
};

export default ToolFavoriteButton;
